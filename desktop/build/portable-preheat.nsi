!include "common.nsh"
!include "extractAppPackage.nsh"
!include "WinMessages.nsh"

# 仍然是 electron-builder 的 portable 自解压包，不使用 NSIS 安装向导。
# 这里只借用系统原生文字与进度条显示“正在解压 Electron”的短暂预热阶段：
# - 不放位图，避免 Windows 高 DPI 把启动图放大得模糊；
# - 不显示欢迎页、按钮栏、功能说明或二次确认弹窗；
# - 解压完成后立即关闭，继续进入我们自己的 Electron 安装器。

CRCCheck off
WindowIcon on
AutoCloseWindow true
RequestExecutionLevel ${REQUEST_EXECUTION_LEVEL}
Caption "药大拾间"
SubCaption 3 ""
BrandingText "药大拾间桌面客户端"
ShowInstDetails nevershow
InstProgressFlags smooth
ManifestDPIAware true

PageEx instfiles
  PageCallbacks cpuPreheatPre cpuPreheatShow cpuPreheatLeave
PageExEnd

Function .onInit
  !insertmacro check64BitAndSetRegView
FunctionEnd

# 预热只有几秒，点关闭不再弹出“是否终止安装”的额外确认框。
Function .onUserAbort
  Abort
FunctionEnd

Function cpuPreheatPre
FunctionEnd

Function cpuPreheatShow
  SendMessage $HWNDPARENT ${WM_SETTEXT} 0 "STR:药大拾间"

  # instfiles 子页：1006 是状态文字，1004 是 NSIS 自动维护的真实解压进度条。
  FindWindow $0 "#32770" "" $HWNDPARENT
  GetDlgItem $1 $0 1006
  SendMessage $1 ${WM_SETTEXT} 0 "STR:启动预热中"
  CreateFont $4 "Microsoft YaHei UI" 13 600
  SendMessage $1 ${WM_SETFONT} $4 1

  GetDlgItem $2 $0 1004
  System::Call "user32::GetSystemMetrics(i 0) i .R5"
  System::Call "user32::GetSystemMetrics(i 1) i .R6"
  IntOp $R7 $R5 - 440
  IntOp $R7 $R7 / 2
  IntOp $R8 $R6 - 190
  IntOp $R8 $R8 / 2
  System::Call "user32::SetWindowPos(p $HWNDPARENT, p 0, i R7, i R8, i 440, i 190, i 0x0014)"
  System::Call "user32::SetWindowPos(p $0, p 0, i 0, i 0, i 440, i 150, i 0x0014)"
  System::Call "user32::SetWindowPos(p $1, p 0, i 28, i 38, i 384, i 30, i 0x0014)"
  System::Call "user32::SetWindowPos(p $2, p 0, i 28, i 88, i 384, i 8, i 0x0014)"

  # 详情日志、详情按钮、底部分隔线与取消按钮全部隐藏，只保留文字和进度。
  GetDlgItem $3 $0 1016
  ShowWindow $3 0
  GetDlgItem $3 $0 1027
  ShowWindow $3 0
  GetDlgItem $3 $0 1031
  ShowWindow $3 0
  GetDlgItem $3 $HWNDPARENT 1035
  ShowWindow $3 0
  GetDlgItem $3 $HWNDPARENT 1028
  ShowWindow $3 0
  GetDlgItem $3 $HWNDPARENT 1
  ShowWindow $3 0
  GetDlgItem $3 $HWNDPARENT 2
  ShowWindow $3 0
  GetDlgItem $3 $HWNDPARENT 3
  ShowWindow $3 0
FunctionEnd

Function cpuPreheatLeave
FunctionEnd

Section
  # 保留真实进度计算，但不再让每个解压文件名覆盖固定的“启动预热中”。
  SetDetailsPrint none

  StrCpy $INSTDIR "$PLUGINSDIR\app"
  !ifdef UNPACK_DIR_NAME
    StrCpy $INSTDIR "$TEMP\${UNPACK_DIR_NAME}"
  !endif

  RMDir /r $INSTDIR
  SetOutPath $INSTDIR

  !ifdef APP_DIR_64
    !ifdef APP_DIR_ARM64
      !ifdef APP_DIR_32
        ${if} ${IsNativeARM64}
          File /r "${APP_DIR_ARM64}\*.*"
        ${elseif} ${RunningX64}
          File /r "${APP_DIR_64}\*.*"
        ${else}
          File /r "${APP_DIR_32}\*.*"
        ${endIf}
      !else
        ${if} ${IsNativeARM64}
          File /r "${APP_DIR_ARM64}\*.*"
        ${else}
          File /r "${APP_DIR_64}\*.*"
        ${endIf}
      !endif
    !else
      !ifdef APP_DIR_32
        ${if} ${RunningX64}
          File /r "${APP_DIR_64}\*.*"
        ${else}
          File /r "${APP_DIR_32}\*.*"
        ${endIf}
      !else
        File /r "${APP_DIR_64}\*.*"
      !endif
    !endif
  !else
    !ifdef APP_DIR_32
      File /r "${APP_DIR_32}\*.*"
    !else
      !insertmacro extractEmbeddedAppPackage
    !endif
  !endif

  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_DIR", "$EXEDIR").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_FILE", "$EXEPATH").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_APP_FILENAME", "${APP_FILENAME}").r0'
  ${StdUtils.GetAllParameters} $R0 0

  # 预热只覆盖解压阶段；进入 Electron 自定义安装器前立刻收起外层窗口。
  HideWindow
  ExecWait "$INSTDIR\${APP_EXECUTABLE_FILENAME} $R0" $0
  SetErrorLevel $0

  SetOutPath $EXEDIR
  RMDir /r $INSTDIR
SectionEnd
