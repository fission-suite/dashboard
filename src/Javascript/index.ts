import * as webnative from "webnative"
import lodashMerge from "lodash/merge"
import * as uint8arrays from "uint8arrays"
import type FileSystem from "webnative/fs/index"
import type { DirectoryPath, FilePath } from "webnative/path"


//----------------------------------------
// GLOBALS / CONFIG
//----------------------------------------

declare global {
  const CONFIG_ENVIRONMENT: string
  const CONFIG_API_ENDPOINT: string
  const CONFIG_LOBBY: string
  const CONFIG_USER: string

  interface Window {
    environment: string
    endpoints: {
      api: string
      lobby: string
      user: string
    }
    webnative: typeof webnative
    fs: FileSystem
    // For recovery.ts
    clearBackup: () => void
  }

  const Elm: any
}

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


//----------------------------------------
// PERMISSIONS
//----------------------------------------

const permissionsBaseline = {
  app: {
    creator: "Fission",
    name: "Dashboard",
  },
  fs: {
    public: [{ directory: ["Apps"] }],
  },
  platform: {
    apps: "*",
  },
}

function lookupLocalStorage(key) {
  const saved = localStorage.getItem(key)
  try {
    return JSON.parse(saved)
  } catch (_) {
    return null
  }
}

function saveLocalStorage(key, json) {
  if (json == null) {
    localStorage.removeItem(key)
  }
  localStorage.setItem(key, JSON.stringify(json, null, 2))
}

const permissionsConfirmedKey = `permissions-confirmed-v1-${window.endpoints.api}`
const lookupPermissionsConfirmed = () => lookupLocalStorage(permissionsConfirmedKey)
const savePermissionsConfirmed = json => saveLocalStorage(permissionsConfirmedKey, json)

const permissionsWantedKey = `permissions-wanted-v1-${window.endpoints.api}`
const lookupPermissionsWanted = () => lookupLocalStorage(permissionsWantedKey)
const savePermissionsWanted = json => saveLocalStorage(permissionsWantedKey, json)

const url = new URL(window.location.href)
if (url.searchParams.get("cancelled") != null) {
  savePermissionsWanted(null)
  url.searchParams.delete("cancelled")
  history.replaceState(null, document.title, url.toString())
}

const permissionsConfirmed = lookupPermissionsConfirmed() || {}
const permissionsWanted = lookupPermissionsWanted() || {}

const permissions = lodashMerge(permissionsBaseline, permissionsConfirmed, permissionsWanted)

console.log("Permissions Confirmed:", permissionsConfirmed)
console.log("Permissions Wanted:", permissionsWanted)
console.log("Permissions now trying:", permissions)


//----------------------------------------
// SETUP ELM APP
//----------------------------------------

const elmApp = Elm.Main.init({
  flags: { permissionsBaseline }
})

elmApp.ports.webnativeRedirectToLobby.subscribe(async ({ permissions }) => {
  console.log("Requesting permissions", permissions)
  savePermissionsWanted(permissions)
  await webnative.redirectToLobby(permissions)
})

elmApp.ports.log.subscribe(messages => {
  console.log.apply(console, messages)
})

elmApp.ports.webnativeResendVerificationEmail.subscribe(async () => {
  try {
    await webnative.lobby.resendVerificationEmail()
  } finally {
    elmApp.ports.webnativeVerificationEmailSent.send({})
  }
})

elmApp.ports.webnativeAppIndexFetch.subscribe(async () => {
  try {
    const index = await webnative.apps.index()
    elmApp.ports.webnativeAppIndexFetched.send(index)
  } catch (error) {
    console.error("Error while fetching the app index", error)
  }
})

elmApp.ports.webnativeAppDelete.subscribe(async appUrl => {
  try {
    await webnative.apps.deleteByDomain(appUrl)
    elmApp.ports.webnativeAppDeleteSucceeded.send({ app: appUrl })
  } catch (error) {
    console.error("Error while fetching the app index", error)
    elmApp.ports.webnativeAppDeleteFailed.send({ app: appUrl, error: error.message })
  }
})

elmApp.ports.webnativeAppRename.subscribe(async ({ from, to }: { from: string, to: string }) => {
  try {
    const fromPath = wnfsAppPath(appNameOnly(from))
    const toPath = wnfsAppPath(appNameOnly(to))
    const newApp = await webnative.apps.create(appNameOnly(to))
    const cid = await getPublicPathCid(wnfsAppPublishPathInPublic(appNameOnly(from)))
    await webnative.apps.publish(newApp.domain, cid)
    await window.fs.mv(fromPath, toPath)
    await webnative.apps.deleteByDomain(from)
    elmApp.ports.webnativeAppRenameSucceeded.send({ app: from, renamed: newApp.domain })
  } catch (error) {
    console.error(`Error while renaming an app from ${from} to ${to}`, error)
    elmApp.ports.webnativeAppRenameFailed.send({ app: from, error: error.message })
  }
})

elmApp.ports.fetchReadKey.subscribe(async () => {
  try {
    const privateHash = await webnative.crypto.sha256Str("/private")
    const keystore = await webnative.keystore.get()
    const readKey = await keystore.getSymmKey(`wnfs__readKey__${privateHash}`)
    const exported = await window.crypto.subtle.exportKey("raw", readKey)
    const encoded = uint8arrays.toString(new Uint8Array(exported), "base64pad")
    elmApp.ports.fetchedReadKey.send({
      key: encoded,
      createdAt: (new Date()).toDateString(),
    })
  } catch (error) {
    console.error(`Error while trying to fetch the readKey for backup`, error)
    elmApp.ports.fetchReadKeyError.send(error.message)
  }
})

elmApp.ports.logout.subscribe(async () => {
  savePermissionsWanted(null)
  savePermissionsConfirmed(null)
  await webnative.leave({ withoutRedirect: true })
  window.location.reload()
})


//----------------------------------------
// WEBNATIVE
//----------------------------------------

webnative
  .initialise({
    permissions
  })
  .then(state => {
    if (state.authenticated) {
      savePermissionsConfirmed(permissions)
    } else {
      savePermissionsConfirmed(null)
    }
    // There should be no further permissions we want to request in the future.
    // We either just got them, or we've got them denied. In any case we stop trying.
    savePermissionsWanted(null)

    if (state.authenticated) {
      window.fs = state.fs;
    }

    elmApp.ports.webnativeInitialized.send(state)

    // Webnative will remove search params after authorisation.
    // To keep the URL in sync, we tell Elm about it
    elmApp.ports.urlChanged.send(window.location.toString())
  })
  .catch(error => {
    console.error("Error in webnative initialisation", error)
    elmApp.ports.webnativeError.send("Initialisation error")
  });


//----------------------------------------
// SERVICE WORKER
//----------------------------------------

if ("serviceWorker" in navigator && window.location.hostname !== "localhost") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js")
  })
}


//----------------------------------------
// CUSTOM ELEMENTS
//----------------------------------------

customElements.define("dashboard-upload-dropzone", class extends HTMLElement {
  inProgress: boolean

  constructor() {
    super()

    this.inProgress = false
  }

  static get observedAttributes() {
    return ["app-name"]
  }

  connectedCallback() {
    // Manage highlighting

    const highlight = async (event: Event) => {
      event.preventDefault()
      this.classList.add("dropping")
    }

    const unhighlight = async (event: Event) => {
      event.preventDefault()
      this.classList.remove("dropping")
    };

    ["dragleave", "drop"].map(ev => this.addEventListener(ev, unhighlight));
    ["dragenter", "dragover"].map(ev => this.addEventListener(ev, highlight));


    // File upload events

    this.addEventListener("change", async event => {
      if (this.inProgress) return
      this.inProgress = true

      event.preventDefault()
      event.stopPropagation()

      const files = Array.from((event.target as HTMLInputElement).files)

      const getFilePath = (file: File) => {
        // We strip off the first part of an uploaded directory (e.g. build/index.html -> index.html)
        const firstSlash = file.webkitRelativePath.indexOf("/")
        const relativePath = file.webkitRelativePath.substring(firstSlash)
        return webnative.path.fromPosix(relativePath) as FilePath
      }
      const getFileContents = async (file: File) => await file.arrayBuffer()

      try {

        this.dispatchPublishStart()

        const appDomain = await this.targetAppDomain()
        await this.publishAppFiles(appDomain, files, getFilePath, getFileContents)

        this.dispatchPublishEnd(appDomain)

      } catch (error) {

        this.dispatchPublishFail()
        throw error

      }

      this.inProgress = false
    })

    this.addEventListener("drop", async event => {
      if (this.inProgress) return
      this.inProgress = true

      event.preventDefault()
      event.stopPropagation()

      try {

        this.dispatchPublishStart()

        const files: FileSystemFileEntry[] = []
        for (const item of event.dataTransfer.items) {
          const entry = item.webkitGetAsEntry()
          const entryFiles = await listFiles(entry)
          entryFiles.forEach(entryFile => {
            files.push(entryFile)
          })
        }

        const getFilePath = (file: FileSystemFileEntry) => webnative.path.fromPosix(file.fullPath) as FilePath
        const getFileContent = async (file: FileSystemFileEntry) => {
          const asJsFile = await fileContent(file)
          return await asJsFile.arrayBuffer()
        }

        const appDomain = await this.targetAppDomain()
        await this.publishAppFiles(appDomain, files, getFilePath, getFileContent)

        this.dispatchPublishEnd(appDomain)

      } catch (error) {

        this.dispatchPublishFail()
        throw error

      }

      this.inProgress = false
    })
  }

  async targetAppDomain() {
    // Expected to be something like "long-tulip.fission.app"
    const appDomain = this.getAttribute("app-domain")
    if (appDomain == null || appDomain === "") {
      this.dispatchPublishAction("Reserving a new subdomain for your app")
      const app = await webnative.apps.create(null)
      return app.domain
    }
    return appDomain
  }

  async publishAppFiles<T>(
    appDomain: string,
    files: T[],
    getFilePath: (file: T) => FilePath,
    getFileContent: (file: T) => Promise<ArrayBuffer>
  ) {
    const appName = appNameOnly(appDomain)
    const appPath = wnfsAppPublishPathInPublic(appName)

    this.dispatchPublishAction("Preparing publish directory")
    const path = webnative.path.combine(webnative.path.directory("public"), appPath)

    if (await window.fs.exists(path)) {
      await window.fs.rm(path)
    }

    const cid = await this.addAppFiles(appPath, files, getFilePath, getFileContent)

    this.dispatchPublishAction("Uploading files to fission")
    await window.fs.publish()

    this.dispatchPublishAction("Telling fission to publish the app")
    await webnative.apps.publish(appDomain, cid)
  }

  async addAppFiles<T>(
    appPath: DirectoryPath,
    files: T[],
    getFilePath: (file: T) => FilePath,
    getFileContent: (file: T) => Promise<ArrayBuffer>
  ) {
    let progress = 0
    const total = files.length * 2

    for (const file of files) {
      const relativePath = getFilePath(file)
      const pathString = webnative.path.toPosix(relativePath)

      this.dispatchPublishProgress(progress, total, `Uploading file to browser: ${pathString}`)
      const arrayBuffer = await getFileContent(file)
      progress += 1

      this.dispatchPublishProgress(progress, total, `Saving file in WNFS: ${pathString}`)
      const path = webnative.path.combine(webnative.path.directory("public"), webnative.path.combine(appPath, relativePath)) as FilePath
      await window.fs.write(path, arrayBuffer as Buffer)
      progress += 1
    }

    return await getPublicPathCid(appPath)
  }


  dispatchPublishAction(info: string) {
    console.log(info)
    this.dispatchEvent(new CustomEvent("publishAction", { detail: { info } }))
  }

  dispatchPublishProgress(progress: number, total: number, info: string) {
    console.log(progress, total, info)
    this.dispatchEvent(new CustomEvent("publishProgress", { detail: { progress, total, info } }))
  }

  dispatchPublishStart() {
    console.log("starting")
    this.dispatchEvent(new CustomEvent("publishStart"))
  }

  dispatchPublishEnd(domain: string) {
    console.log("Done. Your app is live! 🚀")
    this.dispatchEvent(new CustomEvent("publishEnd", { detail: { domain } }))
  }

  dispatchPublishFail() {
    this.dispatchEvent(new CustomEvent("publishFail"))
  }

  disconnectedCallback() {
  }
})



//----------------------------------------
// UTILITIES
//----------------------------------------

function fileContent(file: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    file.file(resolve, reject)
  })
}

function directoryEntries(directory: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    directory.createReader().readEntries(resolve, reject)
  })
}

const isDirectoryEntry = (entry: FileSystemEntry): entry is FileSystemDirectoryEntry => entry.isDirectory
const isFileEntry = (entry: FileSystemEntry): entry is FileSystemFileEntry => entry.isFile

async function listFiles(entry: FileSystemEntry, files: FileSystemFileEntry[] = []) {
  if (isDirectoryEntry(entry)) {
    const entries = await directoryEntries(entry)
    for (const subEntry of entries) {
      await listFiles(subEntry, files)
    }
  }
  if (isFileEntry(entry)) {
    files.push(entry)
  }
  return files
}

async function getPublicPathCid(appPath: DirectoryPath) {
  const appPathString = webnative.path.toPosix(appPath)
  const ipfs = await webnative.ipfs.get()
  const rootCid = await window.fs.root.put()
  const { cid } = await ipfs.files.stat(`/ipfs/${rootCid}/p/${appPathString}`) as any
  return cid.toBaseEncodedString()
}

function wnfsAppPublishPathInPublic(appName: string): DirectoryPath {
  return webnative.path.directory("Apps", appName, "Published")
}

function wnfsAppPath(appName: string): DirectoryPath {
  return webnative.path.directory("public", "Apps", appName)
}

function appNameOnly(appName: string): string {
  return appName.substring(0, appName.indexOf("."))
}
