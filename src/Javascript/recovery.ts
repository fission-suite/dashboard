import * as webnative from "webnative"
import * as did from "webnative/did/index"
import * as dataRoot from "webnative/data-root"
import * as webnativeIpfs from "webnative/ipfs/index"
import * as crypto from "webnative/crypto/index"
import * as namefilter from "webnative/fs/protocol/private/namefilter"
import MMPT from "webnative/fs/protocol/private/mmpt"
import throttle from "lodash/throttle"

import * as awake from "./awake"
import { WebSocketChannel, EncryptedChannel, TextEncodedChannel, JSONChannel, Channel } from "./channel"

//----------------------------------------
// GLOBALS / CONFIG
//----------------------------------------

window.environment = CONFIG_ENVIRONMENT

console.log(`Running in ${window.environment} environment`)

window.endpoints = {
  api: CONFIG_API_ENDPOINT,
  lobby: CONFIG_LOBBY,
  user: CONFIG_USER,
}

window.webnative = webnative

webnative.setup.debug({ enabled: true })
webnative.setup.endpoints(window.endpoints)

const RECOVERY_USERNAME_KEY = "account-recovery-username"
const RECOVERY_BACKUP_KEY = "account-recovery-backup"

window.clearBackup = () => {
  localStorage.removeItem(RECOVERY_USERNAME_KEY)
  localStorage.removeItem(RECOVERY_BACKUP_KEY)
}


//----------------------------------------
// SETUP ELM APP
//----------------------------------------

const elmApp = Elm.Recovery.Main.init({
  flags: {
    endpoints: window.endpoints,
    savedRecovery: {
      username: localStorage.getItem(RECOVERY_USERNAME_KEY),
      key: localStorage.getItem(RECOVERY_BACKUP_KEY)
    }
  }
})

window["elmApp"] = elmApp

elmApp.ports.verifyBackup.subscribe(async (backup: { username: string, key: string }) => {
  try {
    const ipfsPromise = webnativeIpfs.get()
    const rootCID = await tryRethrowing(
      dataRoot.lookupOnFisson(backup.username),
      e => ({
        isUserError: true,
        message: `We couldn't find a user with name "${backup.username}".`,
        contactSupport: false,
        original: e,
      })
    )

    if (rootCID == null) {
      throw {
        isUserError: true,
        message: `We couldn't find a user with name "${backup.username}".`,
        contactSupport: true,
        original: null,
      }
    }

    const ipfs = await ipfsPromise
    const { cid: mmptCID } = await tryRethrowing(
      ipfs.dag.resolve(`/ipfs/${rootCID}/private`),
      e => ({
        isUserError: true,
        message: "Something went wrong: We couldn't find a private filesystem in your personal datastore.",
        contactSupport: true,
        original: e,
      })
    )

    const privateName = await getRootBlockPrivateName(backup.key)

    const mmpt = await tryRethrowing(
      MMPT.fromCID(mmptCID.toString()),
      e => ({
        isUserError: true,
        message: "Something went wrong: We couldn't load your private filesystem.",
        contactSupport: true,
        original: e,
      })
    )

    const privateRootExists = await mmpt.exists(privateName)

    if (!privateRootExists) {
      throw {
        isUserError: true,
        message: "This backup file is invalid.",
        contactSupport: true,
        original: null,
      }
    }
    elmApp.ports.verifyBackupSucceeded.send(backup)
  } catch (e) {
    if (e.isUserError) {
      elmApp.ports.verifyBackupFailed.send({ message: e.message, contactSupport: e.contactSupport })
    }
    if (e.original != null) {
      console.error(e.original)
    }
  }
})

async function tryRethrowing<T, E>(promise: Promise<T>, rethrow: ((error: unknown) => E) | E): Promise<T> {
  let result: T;
  try {
    result = await promise
  } catch (e) {
    if (rethrow instanceof Function) {
      throw rethrow(e)
    } else {
      throw rethrow
    }
  }
  return result
}

async function getRootBlockPrivateName(key: string): Promise<namefilter.PrivateName> {
  const bareName = await namefilter.createBare(key)
  const revisionName = await namefilter.addRevision(bareName, key, 1)
  return await namefilter.toPrivateName(revisionName)
}


elmApp.ports.usernameExists.subscribe(throttle(async (username: string) => {
  if (webnative.lobby.isUsernameValid(username)) {
    const exists = !await webnative.lobby.isUsernameAvailable(username)
    elmApp.ports.usernameExistsResponse.send({ username, valid: true, exists })
  } else {
    elmApp.ports.usernameExistsResponse.send({ username, valid: false, exists: true })
  }
}, 500, { leading: false, trailing: true }))


elmApp.ports.saveUsername.subscribe(async (username: string) => {
  localStorage.setItem(RECOVERY_USERNAME_KEY, username)
})
elmApp.ports.saveBackup.subscribe(async (backup: string) => {
  localStorage.setItem(RECOVERY_BACKUP_KEY, backup)
})


elmApp.ports.fetchWritePublicKey.subscribe(async () => {
  try {
    // Make sure to generate a new publicWriteKey
    await webnative.keystore.clear()
    const publicKeyBase64 = await crypto.keystore.publicWriteKey()
    elmApp.ports.writePublicKeyFetched.send(publicKeyBase64)
  } catch (e) {
    elmApp.ports.writePublicKeyFailure.send(e.message)
  }
})


elmApp.ports.justLikeLinkTheAccountsAndStuff.subscribe(async ({ username, rootPublicKey, readKey }: { username: string, rootPublicKey: string, readKey: string | null }) => {
  const keystorePublicWriteKey = await crypto.keystore.publicWriteKey()
  if (keystorePublicWriteKey !== rootPublicKey) {
    console.error("The public key in the keystore is not the same as the public key used for account recovery", keystorePublicWriteKey, rootPublicKey)
  }

  const wssApi = window.endpoints.api.replace(/^https?:\/\//, "wss://")
  const rootDID = did.publicKeyToDid(rootPublicKey, did.KeyType.RSA)
  const endpoint = `${wssApi}/user/link/${rootDID}`
  const socket = new WebSocket(endpoint)
  const socketChannel = new WebSocketChannel(socket)
  const textChannel = new TextEncodedChannel(socketChannel)

  console.log("Connected to websocket at", endpoint)

  socket.onmessage = m => console.log("got websocket response", m.data)

  while (socket.readyState === socket.OPEN || socket.readyState === socket.CONNECTING) {
    try {
      console.log("Trying to run awake protocol")

      const throwawayDID = await textChannel.receive()

      // If we can't recover the user's files, we generate a new read key for them
      const actualReadKey = readKey != null ? readKey : await crypto.aes.genKeyStr()

      const authorized = awake.authorize({
        inquirerThrowawayDID: throwawayDID,
        channel: socketChannel,
        readKey: actualReadKey,
        validChallenge: challenge => new Promise((resolve, reject) => {
          // FIXME: Change to elmApp.ports.*.subscribe and *.send, etc.
          resolve(true)
        })
      }, {
        log: console.log,
        retriesOnMessages: 10,
        retryIntervalMs: 200,
      })

      if (authorized) {
        return
      }
    } catch (e) {
      console.error("Failed an awake protocol try")
      console.error(e)
    }
  }
})
