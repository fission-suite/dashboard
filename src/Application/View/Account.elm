module View.Account exposing (..)

import Html.Styled exposing (..)
import Html.Styled.Attributes exposing (css)
import Tailwind.Breakpoints exposing (..)
import Tailwind.Utilities exposing (..)
import View.Common exposing (dark, infoTextStyle)
import View.Dashboard


settingText : List (Html msg) -> Html msg
settingText content =
    span
        [ css
            [ dark [ text_gray_400 ]
            , font_display
            , text_gray_200
            ]
        ]
        content


sectionUsername : { username : List (Html msg) } -> Html msg
sectionUsername element =
    View.Dashboard.section []
        [ View.Dashboard.sectionTitle [] [ text "Username" ]
        , View.Dashboard.sectionGroup []
            [ responsiveGroup
                [ span
                    [ css
                        [ md [ w_1over2 ]
                        , infoTextStyle
                        ]
                    ]
                    [ text "Your username is unique among all fission users." ]
                , div
                    [ css
                        [ flex
                        , flex_col
                        , space_y_5
                        ]
                    ]
                    element.username
                ]
            ]
        ]


sectionEmail :
    { verificationStatus : List (Html msg)
    }
    -> Html msg
sectionEmail element =
    View.Dashboard.section []
        [ View.Dashboard.sectionTitle [] [ text "Email" ]
        , View.Dashboard.sectionGroup []
            [ responsiveGroup
                [ span
                    [ css
                        [ md [ w_1over2 ]
                        , infoTextStyle
                        ]
                    ]
                    [ text "Did something go wrong while sending you a verification email on signup?"
                    , br [] []
                    , text "Click this button to request another one:"
                    ]
                , span
                    [ css
                        [ flex
                        , flex_row
                        , items_center
                        , space_x_2
                        ]
                    ]
                    element.verificationStatus
                ]
            ]
        ]


responsiveGroup : List (Html msg) -> Html msg
responsiveGroup content =
    div
        [ css
            [ md
                [ flex_row
                , space_y_0
                , space_x_5
                ]
            , flex
            , flex_col
            , space_y_2
            ]
        ]
        content


groupHeading : List (Html msg) -> Html msg
groupHeading content =
    span
        [ css
            [ md
                [ inline
                , w_1over2
                ]
            , hidden
            , infoTextStyle
            ]
        ]
        content
