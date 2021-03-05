module Authenticated exposing (..)

import Browser
import Dict exposing (Dict)
import FeatherIcons
import Html.Styled as Html exposing (Html)
import Json.Decode as Json
import Ports
import Radix exposing (..)
import Route exposing (Route)
import Url exposing (Url)
import View.Account
import View.AppList
import View.Common
import View.Dashboard
import View.Navigation
import Webnative
import Webnative.Types as Webnative


init : Url -> String -> ( AuthenticatedModel, Cmd Msg )
init url username =
    let
        route =
            Route.fromUrl url
                |> Maybe.withDefault Route.Index
    in
    ( { username = username
      , resendingVerificationEmail = False
      , navigationExpanded = False
      , route = route
      , appList = Nothing
      }
    , commandsByRoute route
    )


onRouteChange : Route -> AuthenticatedModel -> ( AuthenticatedModel, Cmd Msg )
onRouteChange route model =
    ( { model
        | route = route
        , navigationExpanded = False
      }
    , commandsByRoute route
    )


commandsByRoute : Route -> Cmd Msg
commandsByRoute route =
    case route of
        Route.AppList ->
            Ports.webnativeAppIndexFetch ()

        _ ->
            Cmd.none


update : AuthenticatedMsg -> AuthenticatedModel -> ( AuthenticatedModel, Cmd Msg )
update msg model =
    case msg of
        -- Mobile Navigation
        ToggleNavigationExpanded ->
            ( { model | navigationExpanded = not model.navigationExpanded }
            , Cmd.none
            )

        -- Account
        EmailResendVerification ->
            ( { model | resendingVerificationEmail = True }
            , Ports.webnativeResendVerificationEmail {}
            )

        VerificationEmailSent ->
            ( { model | resendingVerificationEmail = False }
            , Cmd.none
            )

        -- App list
        FetchedAppList value ->
            case Json.decodeValue appsIndexDecoder value of
                Ok dict ->
                    let
                        appList =
                            dict
                                |> Dict.toList
                                |> List.concatMap
                                    (\( _, urls ) ->
                                        urls
                                            |> List.concatMap
                                                (\url ->
                                                    case String.split "." url of
                                                        [ subdomain, _, _ ] ->
                                                            [ { name = subdomain
                                                              , url = url
                                                              }
                                                            ]

                                                        _ ->
                                                            []
                                                )
                                    )
                    in
                    ( { model | appList = Just appList }
                    , Cmd.none
                    )

                Err _ ->
                    ( model, Cmd.none )


view : AuthenticatedModel -> Browser.Document Msg
view model =
    { title = "Fission Dashboard"
    , body =
        View.Dashboard.appShell
            { navigation =
                { expanded = model.navigationExpanded
                , onToggleExpanded = AuthenticatedMsg ToggleNavigationExpanded
                , items =
                    List.concat
                        [ [ View.Navigation.header "Users" ]
                        , navigationItems.users |> List.map (viewNavItem model)
                        , [ View.Navigation.header "Developers" ]
                        , navigationItems.developers |> List.map (viewNavItem model)
                        ]
                }
            , main =
                case model.route of
                    Route.Index ->
                        viewAccount model

                    Route.AppList ->
                        viewAppList model
            }
            |> Html.toUnstyled
            |> List.singleton
    }


type alias NavItem =
    { route : Route, name : String, icon : FeatherIcons.Icon }


navigationItems : { users : List NavItem, developers : List NavItem }
navigationItems =
    { users =
        [ { route = Route.Index, name = "Account", icon = FeatherIcons.user }
        ]
    , developers =
        [ { route = Route.AppList, name = "App List", icon = FeatherIcons.code }
        ]
    }


viewNavItem : AuthenticatedModel -> NavItem -> Html Msg
viewNavItem model { route, icon, name } =
    View.Navigation.item []
        { active = route == model.route
        , icon = icon
        , label = name
        , link = route
        }


viewAccount : AuthenticatedModel -> List (Html Msg)
viewAccount model =
    View.Account.workInProgressBanner
        :: List.intersperse View.Common.sectionSpacer
            [ View.Dashboard.heading "Your Account"
            , View.Account.sectionUsername
                { username = [ View.Account.settingText [ Html.text model.username ] ]
                }
            , View.Account.sectionEmail
                { verificationStatus = [ resendVerificationEmailButton model ]
                }
            ]


viewAppList : AuthenticatedModel -> List (Html Msg)
viewAppList model =
    List.intersperse View.Common.sectionSpacer
        [ View.Dashboard.heading "Developed Apps"
        , View.AppList.sectionNewApp
        , case model.appList of
            Just loadedList ->
                loadedList
                    |> List.map View.AppList.appListItem
                    |> View.AppList.sectionAppList

            Nothing ->
                -- TODO Add loading indicator
                View.AppList.sectionAppList
                    []
        ]


resendVerificationEmailButton : AuthenticatedModel -> Html Msg
resendVerificationEmailButton model =
    View.Common.uppercaseButton
        { label = "Resend Verification Email"
        , onClick = AuthenticatedMsg EmailResendVerification
        , isLoading = model.resendingVerificationEmail
        }


subscriptions : AuthenticatedModel -> Sub Msg
subscriptions model =
    Sub.batch
        [ if model.resendingVerificationEmail then
            Ports.webnativeVerificationEmailSent
                (\_ -> AuthenticatedMsg VerificationEmailSent)

          else
            Sub.none
        , Ports.webnativeAppIndexFetched (AuthenticatedMsg << FetchedAppList)
        ]


appsIndexDecoder : Json.Decoder (Dict String (List String))
appsIndexDecoder =
    Json.dict (Json.list Json.string)
