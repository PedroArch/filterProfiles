# Profile Fetcher

Node.js application to fetch profiles from Oracle Commerce Cloud API.

## Features

- Automatic authentication for dev, tst and prod environments
- Paginated profile search (250 at a time)
- Automatic saving of all responses to JSON files
- Support for different search fields (email, firstName, etc.)
- **NEW**: Data mining from consolidated results with multiple filter types
- Automatic CSV export for both search and mining results
- **NEW**: Bulk product deletion with detailed reporting and progress tracking
- **NEW**: Order fetching by ID from CSV files with consolidated results

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd filterProfiles
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env_example .env
```
Edit `.env` file with your actual Oracle Commerce Cloud credentials.

4. Make the scripts executable:
```bash
chmod +x index.js
chmod +x *.sh
chmod +x search_product
chmod +x delete_product
```

## Environment Configuration

**IMPORTANT**: Never commit the `.env` file to version control!

Copy `.env_example` to `.env` and configure with your actual values:

```bash
# Development Environment
DEV_BASE_URL=https://your-dev-instance-admin.occa.ocs.oraclecloud.com
DEV_BEARER_TOKEN=your_actual_dev_token_here

# Test Environment  
TST_BASE_URL=https://your-tst-instance-admin.occa.ocs.oraclecloud.com
TST_BEARER_TOKEN=your_actual_tst_token_here

# Production Environment
PROD_BASE_URL=https://your-prod-instance-admin.occa.ocs.oraclecloud.com
PROD_BEARER_TOKEN=your_actual_prod_token_here
```

## Usage

### Using wrapper scripts (recommended - cleanest syntax)

#### Search profiles by email (returning all fields)
```bash
./search.sh --q=email "pedro" --env=prod
```

#### Search profiles by firstName (returning only specific fields)
```bash
./search.sh --q=firstName "Pedro" --f=firstName,id,email --env=dev
```

#### Search profiles with custom fields
```bash
./search.sh --q=email "pedro.franco" --f=firstName,id --env=prod
```

#### Search products with a custom query
```bash
./search_product --q="not (childSKUs pr)" --f=id,displayName,childSKUs.repositoryId --env=prod
```

#### Delete products from CSV file
```bash
# Auto-finds first file starting with "products" in inputs/ folder
./delete_product --env=prod

# Or specify a specific file
./delete_product products.csv --env=prod
```

#### Fetch orders by ID from CSV file
```bash
# Auto-finds first file starting with "orders" and ending with .csv in inputs/ folder
node index.js searchOrders --env=prod

# Or specify a specific file
node index.js searchOrders orders_20260127_093906.csv --env=tst

# Fetch only specific fields (id is always included)
node index.js searchOrders --env=tst --f=id,profile.email,profile.login
```

#### Test authentication
```bash
./auth.sh --env=dev
```

#### Consolidate results (combine all files into one)
```bash
./search.sh --q=firstName "Pedro" --f=firstName,id,email --c --env=dev
```

### Using npm scripts (requires -- separator)

```bash
npm run searchProfile -- --q=firstName "carlos" --f=firstName,id --env=prod
# or using the shorter alias:
npm run search -- --q=email "pedro" --env=prod

# Search products
npm run searchProduct -- --q="not (childSKUs pr)" --f=id,displayName,childSKUs.repositoryId --env=prod

# Test authentication  
npm run auth -- --env=dev

# Super short aliases (using wrapper scripts):
npm run s --q=firstName "carlos" --f=firstName,id --env=prod
npm run a --env=dev
```

**Note:** NPM requires `--` to separate npm flags from script arguments. For cleaner syntax, use the wrapper scripts below.

### Using node directly

```bash
node index.js searchProfiles --q=firstName "carlos" --env=prod
node index.js searchProducts --q="not (childSKUs pr)" --f=id,displayName,childSKUs.repositoryId --env=prod
node index.js auth --env=dev
```

## Parameters

- `--env`: Environment (dev, tst, prod) - default: dev
- `--q`: Query field (email, firstName, etc.) - required
- `value`: Search value (passed after the options) - required
- `--f`: Fields to return (comma separated, no quotes) - optional
- `--c`: Consolidate all results into a single file and delete originals - optional

## Available NPM Scripts

- `npm run searchProfile` - Full search command (requires `--`)
- `npm run search` - Shorter alias for search (requires `--`)
- `npm run auth` - Authentication test (requires `--`)
- `npm start` - Basic start command

## Recommended Usage

**✅ Best option (wrapper scripts):**
```bash
./search.sh --q=firstName "Sarah" --f=firstName,id --env=prod
./auth.sh --env=prod
```

**✅ NPM with -- separator:**
```bash
npm run searchProfile -- --q=firstName "Sarah" --f=firstName,id --env=prod
```

## Configuration

The `config.json` file contains:
- Base URLs for each environment
- Bearer tokens for initial authentication
- Request limit configurations

## Output

Response files are saved to the `responses/` folder with the format:
`profile_<DD-MM-YYYY>(_<execution_number>)_<request_number>.json`

**File naming examples:**
- First execution of the day: `profile_03-10-2025_1.json`, `profile_03-10-2025_2.json`
- Second execution: `profile_03-10-2025(1)_1.json`, `profile_03-10-2025(1)_2.json`
- Third execution: `profile_03-10-2025(2)_1.json`, `profile_03-10-2025(2)_2.json`

Each file contains:
- Total profiles found
- Request offset
- List of profiles (up to 250 per file)
- Navigation links

**Automatic file management:**
- Prevents overwriting files from multiple executions on the same day
- Sequential execution numbering in parentheses
- Each execution gets its own numbered sequence

## Data Mining

After consolidating search results, you can mine the data using various filter types.

**🧠 Smart Type Detection**: The application automatically analyzes your data fields and detects:
- **Boolean**: true/false values
- **Number**: Integers and decimals (supports >, <, >=, <=, = operators)
- **Date**: ISO dates and common formats (supports ranges)
- **String**: Text values (contains search)

### Usage Options:
```bash
# NPM command (recommended)
npm run mine -- --f=fieldName inputFile.json "condition"

# Direct command
node index.js mineResult --f=fieldName inputFile.json "condition"

# Shell script
./mine.sh inputFile.json --f=fieldName "condition"
```

### Boolean Filters (auto-detected)
```bash
npm run mine -- --f=active profile_consolidated.json "true"
npm run mine -- --f=isSubscribed profile_consolidated.json "false"
```

### Date Range Filters (auto-detected)
```bash
npm run mine -- --f=registrationDate profile_consolidated.json "2020-01-01 2023-12-31"
npm run mine -- --f=lastLoginDate profile_consolidated.json "2024-01-01 2024-12-31"
```

### Numeric Filters (auto-detected)
```bash
npm run mine -- --f=lastPurchaseAmount profile_consolidated.json ">100"
npm run mine -- --f=age profile_consolidated.json ">=18"
npm run mine -- --f=loyaltyPoints profile_consolidated.json "<1000"
npm run mine -- --f=totalOrders profile_consolidated.json "=5"
```

### String Contains Filters (auto-detected)
```bash
npm run mine -- --f=firstName profile_consolidated.json "Pedro"
npm run mine -- --f=email profile_consolidated.json "gmail"
npm run mine -- --f=city profile_consolidated.json "São Paulo"
```

### Mining Output
- `profiles_datamined_YYYY-MM-DD-HH-MM-SS.json` - Filtered data with metadata and field analysis
- `profiles_datamined_YYYY-MM-DD-HH-MM-SS.csv` - CSV format for analysis

### Smart Analysis Features
- **Type Detection**: Automatically analyzes field types from data samples
- **Validation Warnings**: Alerts when condition doesn't match detected field type
- **Field Analysis**: Shows detected type, confidence, and sample values
- **Optimized Filtering**: Uses type-specific filtering for better performance
- **Metadata Tracking**: Saves analysis details in output files

## Result Consolidation

Use the `--c` flag to consolidate all response files into a single result file:

```bash
./search.sh --q=email "carlos" --f=firstName,id,email --c --env=prod
```

**What happens with `--c`:**
1. All individual response files are processed
2. A single consolidated file is created in the `output/` folder
3. Original response files are deleted
4. Consolidated file format:
```json
{
  "total": 1234,
  "env": "prod", 
  "items": [
    // All profile items from all response files
  ]
}
```

**Consolidated file naming:**
- `profile_03-10-2025_consolidated.json`
- `profile_03-10-2025(1)_consolidated.json` 
- `profile_03-10-2025(2)_consolidated.json`

## Usage Examples

1. **Search all profiles with email containing "carlos" (all fields):**
   ```bash
   ./search.sh --q=email "carlos" --env=prod
   ```

2. **Search profiles by name returning only specific fields:**
   ```bash
   ./search.sh --q=firstName "Pedro" --f=firstName,id,email --env=tst
   ```

3. **Search specific profile by complete email:**
   ```bash
   ./search.sh --q=email "pedro.franco@objectedge.com" --f=firstName,id --env=prod
   ```

### Quick Examples

```bash
# Quick search
./search.sh --q=email "pedro" --env=prod

# Search with specific fields only
./search.sh --q=firstName "carlos" --f=firstName,id,email

# Test authentication
./auth.sh --env=prod
```

## Query Parameters

When you use `--f="firstName,id,email"`, the application automatically converts to:
`fields=items.firstName,items.id,items.email`

The final query becomes:
`/ccadmin/v1/profiles?fields=items.firstName,items.id,items.email&q=email co "pedro.franco"`

### New Syntax Benefits

- **Cleaner syntax**: `--q=firstName "carlos"` separates field and value clearly
- **No quotes on fields**: `--f=firstName,id,email` (cleaner than quoted strings)
- **Natural order**: Field specification followed by search value
- **Auto token renewal**: Tokens are automatically renewed when expired (300s lifetime)

### Token Management

The application automatically handles token expiration:
- Tokens have a 300-second (5-minute) lifetime
- Auto-renewal occurs 30 seconds before expiration
- No manual intervention needed for long-running searches
- Seamless token refresh during paginated requests

### NPM Script Syntax Note

NPM requires `--` to separate npm flags from script arguments:

**❌ Won't work:**
```bash
npm run searchProfile --q=firstName "Sarah" --f=firstName,id --env=prod
```

**✅ Works (with --):**
```bash
npm run searchProfile -- --q=firstName "Sarah" --f=firstName,id --env=prod
```

**✅ Clean alternative:**
```bash
./search.sh --q=firstName "Sarah" --f=firstName,id --env=prod
```

The application automatically:
- Logs in and obtains the access token
- Calculates how many requests are needed
- Makes all calls with appropriate offset
- Saves each response to a separate file
- Displays progress in the console

## Product Deletion

### Delete Products from CSV

The `delete_product` script allows you to bulk delete products from Oracle Commerce Cloud using a CSV file.

#### Features:
- **Auto-detection**: Automatically finds files starting with "products" in the `assets/` folder
- **Progress tracking**: Beautiful spinners and progress indicators for each deletion
- **Detailed reporting**: Comprehensive JSON report saved after completion
- **Error handling**: Continues processing even if individual products fail
- **Smart status**: Different colored messages for success, warnings (404), and errors
- **File archiving**: Automatically moves processed CSV files to `assets/processed/` folder with timestamp

#### Usage:

**Auto-find mode (recommended):**
```bash
./delete_product --env=prod
```
This will automatically find and use the first file starting with "products" in the `assets/` folder.

**Specific file mode:**
```bash
./delete_product products.csv --env=prod
./delete_product my-products-list.csv --env=dev
```

**Using node directly:**
```bash
node index.js deleteProducts --env=prod
node index.js deleteProducts products.csv --env=prod
```

#### CSV File Format:

The CSV file should contain one product ID per line:
```
PA0000110124
PA0000110125
PA0000140023
PA0000140143
```

Place the file in the `assets/` folder.

#### Output:

**During execution:**
- Real-time progress with spinners
- Color-coded status messages:
  - 🟢 Green: Successful deletion
  - 🟡 Yellow: Product not found (404)
  - 🔴 Red: Deletion failed (error)
- Progress counter: `[1/100]`, `[2/100]`, etc.

**Final report:**
```
============================================================
📊 DELETION REPORT
============================================================
🎯 Total products: 100
✅ Successfully deleted: 98
❌ Failed: 2
📁 Report saved to: delete_report_2026-01-07-14-30-45.json
============================================================

✅ CSV file moved to: assets/processed/products_2026-01-07-14-30-45.csv
```

**Report file** (saved in `output/` folder):
```json
{
  "total": 100,
  "deleted": 98,
  "failed": 2,
  "errors": [
    {
      "productId": "PA0000123",
      "error": "Product not found",
      "statusCode": 404
    }
  ],
  "startTime": "2026-01-07T14:30:45.000Z",
  "endTime": "2026-01-07T14:32:15.000Z",
  "environment": "prod"
}
```

#### API Endpoint Used:
```
DELETE https://{{admin}}/ccadmin/v1/products/{productId}
```

#### File Management:
After successful processing, the CSV file is automatically:
1. Moved to `assets/processed/` folder
2. Renamed with timestamp: `products_YYYY-MM-DD-HH-MM-SS.csv`
3. The `processed/` folder is created automatically if it doesn't exist
4. Original file in `assets/` is removed

This prevents accidentally re-processing the same file and maintains a clear history of processed deletions.

#### Best Practices:
1. Always test in `dev` or `tst` environment first
2. Keep backup of your CSV file (processed files are archived in `assets/processed/`)
3. Review the deletion report after completion
4. Monitor for 404 errors (products already deleted or don't exist)
5. Check `assets/processed/` folder for history of processed files

## Order Fetching

### Fetch Orders by ID from CSV

The `searchOrders` command allows you to fetch order details from Oracle Commerce Cloud using order IDs from a CSV file.

#### Features:
- **Auto-detection**: Automatically finds CSV files starting with "orders" in the `inputs/` folder
- **Progress tracking**: Real-time progress indicators for each order fetch
- **Consolidated output**: All orders saved in a single JSON file with metadata
- **CSV export**: Automatic CSV generation for easy data analysis
- **Detailed reporting**: Comprehensive JSON report with success/failure statistics
- **Error handling**: Continues processing even if individual orders fail (404s, errors)
- **Smart status**: Color-coded messages for success, warnings, and errors

#### Usage:

**Auto-find mode (recommended):**
```bash
node index.js searchOrders --env=prod
```
This will automatically find and use the first CSV file starting with "orders" in the `inputs/` folder.

**Specific file mode:**
```bash
node index.js searchOrders orders_20260127_093906.csv --env=prod
node index.js searchOrders my-order-list.csv --env=dev
```

**Using different environments:**
```bash
node index.js searchOrders --env=dev
node index.js searchOrders --env=tst
node index.js searchOrders --env=prod
```

**Selecting specific fields:**
```bash
# Fetch only specific fields from each order
node index.js searchOrders --env=tst --f=id,profile.email,profile.login

# More field examples
node index.js searchOrders --env=prod --f=id,state,submittedDate,profile.email
node index.js searchOrders --env=dev --f=id,priceInfo.total,profile.firstName,profile.lastName
```

The `id` field is always included in the response by default. You can specify any valid order fields such as:
- `profile.email`, `profile.login`, `profile.firstName`
- `state`, `submittedDate`, `orderId`
- `priceInfo.total`, `priceInfo.shipping`
- And any other order object fields

#### CSV File Format:

The CSV file should contain one order ID per line, with optional header:
```csv
orderId
so2750028
so2750020
so2740536
```

Or without header:
```
so2750028
so2750020
so2740536
```

Place the file in the `inputs/` folder (the script automatically skips the header if present).

#### Output:

**During execution:**
- Real-time progress with spinners
- Color-coded status messages:
  - 🟢 Green: Successful fetch
  - 🟡 Yellow: Order not found (404)
  - 🔴 Red: Fetch failed (error)
- Progress counter: `[1/422]`, `[2/422]`, etc.

**Final report:**
```
============================================================
📊 ORDERS FETCH REPORT
============================================================
🎯 Total orders: 422
✅ Successfully fetched: 420
❌ Failed: 2
📁 Orders data saved to: orders_2026-01-27-09-45-30.json
📁 CSV saved to: orders_2026-01-27-09-45-30.csv
📁 Report saved to: orders_report_2026-01-27-09-45-30.json
============================================================
```

**Output files** (saved in `outputs/` folder):

1. **Consolidated orders JSON:**
```json
{
  "total": 420,
  "env": "prod",
  "items": [
    {
      "orderId": "so2750028",
      "state": "PENDING_PAYMENT",
      "submittedDate": "2026-01-22T16:48:45.000Z",
      // ... complete order data
    }
  ]
}
```

2. **Orders CSV:** All order data in spreadsheet format with all fields as columns

3. **Report JSON:**
```json
{
  "total": 422,
  "fetched": 420,
  "failed": 2,
  "errors": [
    {
      "orderId": "so123456",
      "error": "Order not found",
      "statusCode": 404
    }
  ],
  "startTime": "2026-01-27T09:45:30.000Z",
  "endTime": "2026-01-27T09:48:15.000Z",
  "environment": "prod"
}
```

#### API Endpoint Used:
```
GET https://{{admin}}/ccadmin/v1/orders/{orderId}
```

#### Creating Order ID CSV Files:

You can extract order IDs from order history JSON files:

**From orders.json to CSV:**
```bash
# Extract all orderIds and create CSV
grep -oP '"orderId":\s*"\K[^"]+' inputs/orders.json > inputs/orders_$(date +%Y%m%d_%H%M%S).csv
```

Or use the built-in extraction as demonstrated in the examples above.

#### Best Practices:
1. Always test in `dev` or `tst` environment first
2. Keep your source CSV files in the `inputs/` folder
3. Review the fetch report after completion
4. Monitor for 404 errors (orders that don't exist or were deleted)
5. Use the generated CSV for easy analysis in spreadsheet software
6. Check the consolidated JSON for complete order data with proper structure
