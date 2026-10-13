; 「卸载 BillyShot」小工具：放在安装包旁边，双击就能找到这台电脑上已安装的 BillyShot 并打开它的卸载程序
; 编译：node scripts/build-uninstall-tool.js（npm run dist:win 会自动编译）
; 本文件含中文，必须保存为 UTF-8 带 BOM
Unicode true
; 高分辨率屏幕上提示框不发糊（不声明的话 Windows 会把 100% 的画面拉大）
ManifestDPIAware true
!include LogicLib.nsh
!include FileFunc.nsh

!ifndef OUTFILE
  !define OUTFILE "dist\卸载BillyShot-Uninstall.exe"
!endif
!ifndef VERSION
  !define VERSION "0.0.0"
!endif
; electron-builder 按 appId（com.billyshot.app）算出的固定 GUID，安装程序把卸载信息写在这个键下
!define APP_GUID "c5641b28-4afb-5c59-acf2-9d7515db2c14"
!define UNKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}"
!define INSTKEY "Software\${APP_GUID}"

Name "BillyShot Uninstall"
Caption "BillyShot"
OutFile "${OUTFILE}"
Icon "..\assets\icon.ico"
RequestExecutionLevel user
; 不显示安装界面；是否「静默」看命令行有没有 /S（SilentInstall silent 会让 ${Silent} 永远为真，不能用）
SilentInstall silent
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "BillyShot Uninstall"
VIAddVersionKey "FileDescription" "Uninstall BillyShot / 卸载 BillyShot"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "Free for everyone"

Var zh
Var cmd
Var quiet

Function readFrom
  ; $0 = 根键（0 = HKCU，1 = HKLM），结果放 $cmd
  ${If} $0 == 0
    ReadRegStr $cmd HKCU "${UNKEY}" "UninstallString"
    ${If} $cmd == ""
      ReadRegStr $1 HKCU "${INSTKEY}" "InstallLocation"
      ${If} $1 != ""
      ${AndIf} ${FileExists} "$1\Uninstall BillyShot.exe"
        StrCpy $cmd '"$1\Uninstall BillyShot.exe" /currentuser'
      ${EndIf}
    ${EndIf}
  ${Else}
    ReadRegStr $cmd HKLM "${UNKEY}" "UninstallString"
    ${If} $cmd == ""
      ReadRegStr $1 HKLM "${INSTKEY}" "InstallLocation"
      ${If} $1 != ""
      ${AndIf} ${FileExists} "$1\Uninstall BillyShot.exe"
        StrCpy $cmd '"$1\Uninstall BillyShot.exe" /allusers'
      ${EndIf}
    ${EndIf}
  ${EndIf}
FunctionEnd

Section
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/S" $R1
  ${If} ${Errors}
    StrCpy $quiet 0
  ${Else}
    StrCpy $quiet 1
  ${EndIf}
  ; 系统界面语言是中文（简体 / 繁体）就用中文提示
  System::Call 'kernel32::GetUserDefaultUILanguage() i .r0'
  IntOp $0 $0 & 0x3FF
  ${If} $0 == 4
    StrCpy $zh 1
  ${Else}
    StrCpy $zh 0
  ${EndIf}

  StrCpy $cmd ""
  SetRegView 64
  StrCpy $0 0
  Call readFrom
  ${If} $cmd == ""
    StrCpy $0 1
    Call readFrom
  ${EndIf}
  ${If} $cmd == ""
    SetRegView 32
    StrCpy $0 1
    Call readFrom
  ${EndIf}
  ; 注册表被清理过：试默认安装位置
  ${If} $cmd == ""
  ${AndIf} ${FileExists} "$LOCALAPPDATA\Programs\BillyShot\Uninstall BillyShot.exe"
    StrCpy $cmd '"$LOCALAPPDATA\Programs\BillyShot\Uninstall BillyShot.exe" /currentuser'
  ${EndIf}

  ${If} $cmd == ""
    ${If} $quiet == 1
      ; 静默模式不弹窗
    ${ElseIf} $zh == 1
      MessageBox MB_OK|MB_ICONINFORMATION "这台电脑上没有找到已安装的 BillyShot。$\r$\n$\r$\n如果你用的是免安装版（zip），直接删除那个文件夹即可。"
    ${Else}
      MessageBox MB_OK|MB_ICONINFORMATION "BillyShot is not installed on this computer.$\r$\n$\r$\nIf you use the portable (zip) version, just delete its folder."
    ${EndIf}
    SetErrorLevel 2
    Quit
  ${EndIf}

  ; 找到了：打开 BillyShot 自己的卸载程序（它会确认、关闭正在运行的 BillyShot，并询问是否删除设置）
  ${If} $quiet == 1
    ExecWait '$cmd /S' $2
    SetErrorLevel $2
  ${Else}
    Exec '$cmd'
  ${EndIf}
SectionEnd
