; RouteAI EDA - Custom NSIS Installer Script
; Adds Ollama install checkbox and optional PATH entry

!include "MUI2.nsh"

Var OllamaCheckbox
Var AddToPathCheckbox

; ---------------------------------------------------------------------------
; Custom page: Optional components
; ---------------------------------------------------------------------------
Function customOptionsPage
  nsDialogs::Create 1018
  Pop $0

  ${NSD_CreateLabel} 0 0 100% 24u "Optional components for RouteAI EDA:"
  Pop $0

  ${NSD_CreateCheckbox} 12u 30u 100% 12u "Open Ollama download page after install (recommended for local AI)"
  Pop $OllamaCheckbox
  ${NSD_Check} $OllamaCheckbox

  ${NSD_CreateLabel} 24u 44u 100% 12u "Ollama enables local LLM inference. Download from https://ollama.ai"
  Pop $0
  SetCtlColors $0 0x666666 transparent

  ${NSD_CreateCheckbox} 12u 64u 100% 12u "Add RouteAI to system PATH"
  Pop $AddToPathCheckbox

  nsDialogs::Show
FunctionEnd

Function customOptionsPageLeave
  ${NSD_GetState} $OllamaCheckbox $0
  ${NSD_GetState} $AddToPathCheckbox $1
  StrCpy $R0 $0 ; Ollama state
  StrCpy $R1 $1 ; PATH state
FunctionEnd

; ---------------------------------------------------------------------------
; Post-install actions
; ---------------------------------------------------------------------------
Function customFinishActions
  ; Open Ollama download page if checkbox was checked
  StrCmp $R0 ${BST_CHECKED} 0 +2
    ExecShell "open" "https://ollama.ai/download/windows"

  ; Add to PATH if checkbox was checked
  StrCmp $R1 ${BST_CHECKED} 0 +4
    ReadRegStr $0 HKCU "Environment" "Path"
    StrCpy $0 "$0;$INSTDIR"
    WriteRegExpandStr HKCU "Environment" "Path" $0
FunctionEnd

; Hook into the installer page sequence
!macro customHeader
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW customOptionsPage
!macroend

; Hook post-install
!macro customInstall
  Call customFinishActions
!macroend
