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
        Write-Host "No workflows found." -ForegroundColor Red
        exit 1
    }

    $selectedIndex = 0

    :menu while ($true) {
        Clear-Host
        Write-Host ""
        Write-Host "  Aydream GitHub Actions" -ForegroundColor Cyan
        Write-Host "  =====================" -ForegroundColor DarkCyan
        Write-Host ""
        Write-Host "  ↑ / ↓  Select workflow" -ForegroundColor Gray
        Write-Host "  Enter  Run workflow" -ForegroundColor Green
        Write-Host "  Esc    Cancel" -ForegroundColor Yellow
        Write-Host ""

        for ($n = 0; $n -lt $workflows.Count; $n++) {
            $state = $workflows[$n].state

            if ($state -eq "active") {
                $stateColor = "Green"
            } else {
                $stateColor = "DarkGray"
            }

            if ($n -eq $selectedIndex) {
                Write-Host ("  > " + $workflows[$n].name) -ForegroundColor White -BackgroundColor DarkBlue -NoNewline
                Write-Host ("  [" + $state + "]") -ForegroundColor $stateColor -BackgroundColor DarkBlue
            } else {
                Write-Host ("    " + $workflows[$n].name) -ForegroundColor White -NoNewline
                Write-Host ("  [" + $state + "]") -ForegroundColor $stateColor
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
    Write-Host ""
    Write-Host "  ▶ Running workflow" -ForegroundColor Cyan
    Write-Host "  $($selected.name)" -ForegroundColor White
    Write-Host ""

    gh workflow run $selected.path --repo $repo --ref main

    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "  ✖ Failed to start workflow." -ForegroundColor Red
        exit $LASTEXITCODE
    }

    Write-Host ""
    Write-Host "  ✔ Workflow started successfully." -ForegroundColor Green
}
catch {
    Write-Host ""
    Write-Host "  ✖ Error:" -ForegroundColor Red
    Write-Host "  $($_.Exception.Message)" -ForegroundColor Yellow
    exit 1
}
