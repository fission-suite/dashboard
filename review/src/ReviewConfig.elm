module ReviewConfig exposing (config)

{-| Do not rename the ReviewConfig module or the config function, because
`elm-review` will look for these.

To add packages that contain rules, add them to this review project using

    `elm install author/packagename`

when inside the directory containing this file.

-}

import NoMissingSubscriptionsCall
import NoMissingTypeExpose
import NoRecursiveUpdate
import NoUnused.CustomTypeConstructorArgs
import NoUnused.CustomTypeConstructors
import NoUnused.Dependencies
import NoUnused.Exports
import NoUnused.Modules
import NoUnused.Parameters
import NoUnused.Patterns
import NoUnused.Variables
import Review.Rule as Rule exposing (Rule)


config : List Rule
config =
    List.concat
        [ noUnused
        , [ NoMissingTypeExpose.rule
          , NoMissingSubscriptionsCall.rule
          , NoRecursiveUpdate.rule
          ]
        ]


noUnused : List Rule
noUnused =
    [ NoUnused.CustomTypeConstructors.rule []
    , NoUnused.CustomTypeConstructorArgs.rule
    , NoUnused.Dependencies.rule
    , NoUnused.Exports.rule
    , NoUnused.Modules.rule
    , NoUnused.Parameters.rule
    , NoUnused.Patterns.rule
    , NoUnused.Variables.rule
    ]
        |> List.map
            (Rule.ignoreErrorsForDirectories
                [ "src/Generated/"

                -- Because it's more like a mini-library inside our application
                , "src/Application/Webnative/"
                ]
            )
