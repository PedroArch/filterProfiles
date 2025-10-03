#!/bin/bash

# Profile Data Mining Script
# Usage: ./mine.sh <inputFile> --f=<field> <condition>
# Examples:
#   ./mine.sh profile_03-10-2025_consolidated.json --f=active true
#   ./mine.sh profile_03-10-2025_consolidated.json --f=registrationDate "2020-01-01 2023-12-31"
#   ./mine.sh profile_03-10-2025_consolidated.json --f=firstName "Pedro"
#   ./mine.sh profile_03-10-2025_consolidated.json --f=lastPurchaseAmount ">20"

node index.js mineResult "$@"