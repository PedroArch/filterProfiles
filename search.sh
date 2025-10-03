#!/bin/bash

# Profile Fetcher Wrapper Script  
# Usage: ./search.sh --q=firstName "carlos" --f=firstName,id --env=prod

node index.js searchProfiles "$@"