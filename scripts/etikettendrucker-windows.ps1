# Legt die Papierformate für die GoldRegenDB-Etiketten in Windows an.
# Aufruf (PowerShell als Administrator):
#   powershell -ExecutionPolicy Bypass -File .\etikettendrucker-windows.ps1

$ErrorActionPreference = "Stop"

$istAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $istAdmin) { throw "Bitte PowerShell als Administrator starten." }

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class Formulare {
    [StructLayout(LayoutKind.Sequential)]
    struct SIZEL { public int cx; public int cy; }

    [StructLayout(LayoutKind.Sequential)]
    struct RECTL { public int left; public int top; public int right; public int bottom; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct FORM_INFO_1 {
        public int Flags;
        [MarshalAs(UnmanagedType.LPWStr)] public string pName;
        public SIZEL Size;
        public RECTL ImageableArea;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool ClosePrinter(IntPtr handle);
    [DllImport("winspool.drv", EntryPoint = "AddFormW", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool AddForm(IntPtr handle, int level, ref FORM_INFO_1 form);
    [DllImport("winspool.drv", EntryPoint = "DeleteFormW", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool DeleteForm(IntPtr handle, string name);

    // Maße in 1/1000 mm; Flags 0 = benutzerdefiniertes Formular
    public static void Anlegen(string name, int breite, int hoehe) {
        IntPtr h;
        if (!OpenPrinter(null, out h, IntPtr.Zero))
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        try {
            DeleteForm(h, name);
            var f = new FORM_INFO_1 {
                Flags = 0,
                pName = name,
                Size = new SIZEL { cx = breite, cy = hoehe },
                ImageableArea = new RECTL { left = 0, top = 0, right = breite, bottom = hoehe }
            };
            if (!AddForm(h, 1, ref f))
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        } finally { ClosePrinter(h); }
    }
}
"@

# Groß hochkant 40x45 (Chrome/CUPS dreht Querformat-Seiten sonst und schneidet ab),
# Klein 30x20 quer
[Formulare]::Anlegen("Etikett Gross 40x30mm", 40000, 45000)
[Formulare]::Anlegen("Etikett Klein 30x20mm", 30000, 20000)

Write-Host ""
Write-Host "Formulare angelegt. Jetzt manuell im Druckertreiber (einmalig):"
Write-Host "  Einstellungen > Drucker und Scanner > M220 > Druckeinstellungen"
Write-Host "  - Medientyp: Etiketten mit Lücke (Gap)"
Write-Host "  - Drehung / 'Rotate' aus (0 Grad)"
Write-Host "Chrome komplett neu starten, im Druckdialog 'Etikett Gross 40x30mm' wählen,"
Write-Host "Ränder: Keine, Skalierung: An Seite anpassen."
