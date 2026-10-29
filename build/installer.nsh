; Hopsnap 安装 / 卸载的自定义步骤（由 electron-builder 的 NSIS 模板引入）
; 本文件含中文，必须保存为 UTF-8 带 BOM，否则 makensis 会按 ANSI 读取导致乱码

; ---------------------------------------------------------------------------
; 高分辨率屏幕（4K / 2K）：声明「DPI 感知」
; 不声明的话，Windows 会先按 100% 缩放把安装界面画好，再整张拉大到 150% / 200%，文字发糊。
; 声明后按系统实际缩放直接绘制：4K 屏就是 4K 清晰度，1080p 屏就是 1080p，都不拉伸。
; 这个文件被安装程序和卸载程序（Uninstall Hopsnap.exe）共用，两个都会生效。
; ---------------------------------------------------------------------------
ManifestDPIAware true

; 向导左侧的品牌图：每种常见系统缩放各一张（scripts/make_installer_sidebar.py 生成），
; 显示时按图片框的实际像素挑最接近的一张，基本是 1:1，不会被拉糊。
!define BILLY_SIDEBAR_DIR "${__FILEDIR__}/sidebar"

!macro BILLY_FIT_SIDEBAR HWND BMP
  System::Store "S"
  System::Call 'user32::GetClientRect(p${HWND}, @r0)'
  System::Call '*$0(i, i, i .r1, i .r2)'
  ; 宽度 = 164 × 缩放比例；取中间值作为分界，挑最接近的一张
  ${If} $1 < 185
    File "/oname=$PLUGINSDIR\billy-side.bmp" "${BILLY_SIDEBAR_DIR}/side-100.bmp"
  ${ElseIf} $1 < 226
    File "/oname=$PLUGINSDIR\billy-side.bmp" "${BILLY_SIDEBAR_DIR}/side-125.bmp"
  ${ElseIf} $1 < 267
    File "/oname=$PLUGINSDIR\billy-side.bmp" "${BILLY_SIDEBAR_DIR}/side-150.bmp"
  ${ElseIf} $1 < 308
    File "/oname=$PLUGINSDIR\billy-side.bmp" "${BILLY_SIDEBAR_DIR}/side-175.bmp"
  ${ElseIf} $1 < 349
    File "/oname=$PLUGINSDIR\billy-side.bmp" "${BILLY_SIDEBAR_DIR}/side-200.bmp"
  ${ElseIf} $1 < 390
    File "/oname=$PLUGINSDIR\billy-side.bmp" "${BILLY_SIDEBAR_DIR}/side-225.bmp"
  ${ElseIf} $1 < 451
    File "/oname=$PLUGINSDIR\billy-side.bmp" "${BILLY_SIDEBAR_DIR}/side-250.bmp"
  ${Else}
    File "/oname=$PLUGINSDIR\billy-side.bmp" "${BILLY_SIDEBAR_DIR}/side-300.bmp"
  ${EndIf}
  ; IMAGE_BITMAP = 0，LR_LOADFROMFILE = 0x10；按图片框实际大小载入（和挑中的图只差几个像素）
  System::Call 'user32::LoadImage(p 0, t "$PLUGINSDIR\billy-side.bmp", i 0, i r1, i r2, i 0x10) p .r3'
  ${If} $3 != 0
    SendMessage ${HWND} 0x0172 0 $3   ; STM_SETIMAGE
    System::Call 'gdi32::DeleteObject(p ${BMP})'
    StrCpy ${BMP} $3
  ${EndIf}
  System::Store "L"
!macroend

; 安装完成页（和 electron-builder 默认的完成页一样，只是多了换图）
!macro customFinishPage
  !ifndef HIDE_RUN_AFTER_FINISH
    Function StartApp
      ${if} ${isUpdated}
        StrCpy $1 "--updated"
      ${else}
        StrCpy $1 ""
      ${endif}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd

    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !endif
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW billyFinishShow
  !insertmacro MUI_PAGE_FINISH
  Function billyFinishShow
    !insertmacro BILLY_FIT_SIDEBAR $mui.FinishPage.Image $mui.FinishPage.Image.Bitmap
  FunctionEnd
!macroend

; 卸载欢迎页
!macro customUnWelcomePage
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.billyWelcomeShow
  !insertmacro MUI_UNPAGE_WELCOME
  Function un.billyWelcomeShow
    !insertmacro BILLY_FIT_SIDEBAR $mui.WelcomePage.Image $mui.WelcomePage.Image.Bitmap
  FunctionEnd
!macroend

; 安装：在开始菜单加一个「卸载呱咔」快捷方式（英文系统叫 Uninstall Hopsnap）
!macro customInstall
  Delete "$SMPROGRAMS\卸载呱咔.lnk"
  Delete "$SMPROGRAMS\Uninstall Hopsnap.lnk"
  ${if} $LANGUAGE == 2052
  ${orIf} $LANGUAGE == 1028
    CreateShortCut "$SMPROGRAMS\卸载呱咔.lnk" "$INSTDIR\${UNINSTALL_FILENAME}" "" "$INSTDIR\uninstallerIcon.ico" 0 SW_SHOWNORMAL "" "卸载呱咔"
  ${else}
    CreateShortCut "$SMPROGRAMS\Uninstall Hopsnap.lnk" "$INSTDIR\${UNINSTALL_FILENAME}" "" "$INSTDIR\uninstallerIcon.ico" 0 SW_SHOWNORMAL "" "Uninstall Hopsnap"
  ${endIf}
!macroend

; 卸载开始前：问用户要不要同时删除设置和截图历史（保存的截图和录屏视频永远不删）
;  · 是：卸载并删除设置；否：卸载但保留设置；取消：不卸载
;  · 静默卸载（/S）和升级安装（--updated，会先运行旧版卸载程序）时不问、不删
;  · 放在 un.onInit 里问（卸载进度页里弹窗在部分系统上会被直接跳过）
!macro customUnInit
  Var /GLOBAL billyshotDelData
  StrCpy $billyshotDelData "0"
  ${ifNot} ${Silent}
  ${andIfNot} ${isUpdated}
    ${if} $LANGUAGE == 2052
    ${orIf} $LANGUAGE == 1028
      StrCpy $R8 "要同时删除 Hopsnap 的设置和截图历史吗？$\r$\n$\r$\n是：卸载，并删除快捷键、录屏选项和截图历史。$\r$\n否：卸载，但保留这些设置，以后重新安装还能接着用。$\r$\n取消：不卸载。$\r$\n$\r$\n你保存的截图和录屏视频不会被删除。"
    ${else}
      StrCpy $R8 "Also delete Hopsnap's settings and screenshot history?$\r$\n$\r$\nYes: uninstall and delete shortcuts, recording options and screenshot history.$\r$\nNo: uninstall but keep them, so a reinstall picks up where you left off.$\r$\nCancel: don't uninstall.$\r$\n$\r$\nYour saved screenshots and recordings are never deleted."
    ${endIf}
    MessageBox MB_YESNOCANCEL|MB_ICONQUESTION|MB_DEFBUTTON2 "$R8" IDYES billyshot_del_yes IDNO billyshot_del_no
      Quit
    billyshot_del_yes:
      StrCpy $billyshotDelData "1"
    billyshot_del_no:

  ${endIf}
!macroend

; 卸载：
;  · 清理开机自启注册表项（新旧两种名称）
;  · 删除开始菜单里的「卸载呱咔」快捷方式
;  · 用户选了「是」就删除设置和截图历史（%APPDATA%\Hopsnap）
; 升级安装时也会先运行旧版卸载程序（isUpdated），这时以上都不能做，否则设置和开机自启会丢
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Hopsnap"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.hopsnap.app"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.Hopsnap"
    Delete "$SMPROGRAMS\卸载呱咔.lnk"
    Delete "$SMPROGRAMS\Uninstall Hopsnap.lnk"
    ${if} $billyshotDelData == "1"
      RMDir /r "$APPDATA\Hopsnap"
    ${endIf}
  ${endIf}
!macroend
