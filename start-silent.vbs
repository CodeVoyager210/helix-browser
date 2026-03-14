Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
' Get the folder where this script is located
strScriptPath = FSO.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = strScriptPath
' Run npm start silently
WshShell.Run "cmd /c npm start", 0, False
