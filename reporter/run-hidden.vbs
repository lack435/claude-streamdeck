' Launches the reporter with no console window. report.mjs loops on its own.
Dim sh, fso, dir, node
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName) & "\"
node = dir & "node.exe"
If Not fso.FileExists(node) Then node = "node"
sh.Run """" & node & """ """ & dir & "report.mjs""", 0, False
