Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repo = "TheROMZ52/aydream-bot"

try {
    $json = gh workflow list --repo $repo --all --json name,path,state 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw ($json -join [Environment]::NewLine)
    }

    $workflows = @($json | ConvertFrom-Json)
    if ($workflows.Count -eq 0) {
        Write-Host "No workflows found."
        exit 1
    }

    $selectedIndex = 0

    :menu while ($true) {
        Clear-Host
        Write-Host "Aydream GitHub Actions"
        Write-Host "====================="
        Write-Host "Use Up/Down arrows, then press Enter. Press Esc to cancel."
        Write-Host ""

        for ($n = 0; $n -lt $workflows.Count; $n++) {
            if ($n -eq $selectedIndex) {
                Write-Host ("> " + $workflows[$n].name + " [" + $workflows[$n].state + "]")
            } else {
                Write-Host ("  " + $workflows[$n].name + " [" + $workflows[$n].state + "]")
            }
        }

        $key = [Console]::ReadKey($true)

        switch ($key.Key) {
            "UpArrow" {
                $selectedIndex--
                if ($selectedIndex -lt 0) {
                    $selectedIndex = $workflows.Count - 1
                }
            }
            "DownArrow" {
                $selectedIndex++
                if ($selectedIndex -ge $workflows.Count) {
                    $selectedIndex = 0
                }
            }
            "Enter" {
                break menu
            }
            "Escape" {
                exit 0
            }
        }
    }

    $selected = $workflows[$selectedIndex]

    Clear-Host
    Write-Host ("Running: " + $selected.name)
    Write-Host ""

    gh workflow run $selected.path --repo $repo --ref main

    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "Failed to start workflow."
        exit $LASTEXITCODE
    }

    Write-Host ""
    Write-Host "Workflow started successfully."
}
catch {
    Write-Host ""
    Write-Host "Error:"
    Write-Host $_.Exception.Message
    exit 1
}
