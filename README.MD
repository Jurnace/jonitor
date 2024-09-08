# Jonitor

A web application for displaying real time hardware information in tables and charts. The backend
runs on Windows and hardware information is read from [HWiNFO](https://www.hwinfo.com).

![Jonitor screenshot](/screenshots/dashboard.png)

## Features

- Show hardware information in:
    - tables
    - bar charts
    - line charts
    - gauge charts
- Build custom dashboards
- Light and dark mode support
- Responsive layout

## Get started

1. Download and install [HWiNFO](https://www.hwinfo.com).
2. Download [Jonitor](https://github.com/Jurnace/jonitor/releases) and unzip the files to a folder.
3. Run HWiNFO in "Sensors-only" mode with "Shared Memory Support" enabled.\
![HWiNFO](/screenshots/hwinfo.png)\
![HWiNFO Settings](/screenshots/hwinfo-settings.png)
4. Run `jonitor.exe`.
5. Open a web browser and navigate to http://127.0.0.1:10110.

## Configure Jonitor

### Configuration file

The following options can be changed in `config.json`.
- `ip` - The IP address to bind to by Jonitor.
- `port` - The port to listen on by Jonitor.
- `polling_interval` - The interval in milliseconds is the frequency at which Jonitor reads data
from HWiNFO. The interval must be at least 1000 milliseconds.

### Command line option

- `--close-on-error` - Close Jonitor immediately when an error occurs. When this flag is not set,
Jonitor waits for the Enter key to be pressed before closing, so the error message can be seen.

## Development setup

### Requirements

- Rust stable
- Node.js 20 LTS

### Running
```
# before running the backend, make sure HWiNFO is running in Sensors-only mode with Shared Memory Support enabled
cargo run

# frontend
cd web
npm install
npm run dev
```
Navigate to http://localhost:5173 in a web browser. Requests to the backend are proxied.

## Building

```
# backend
cargo build --release

# frontend
cd web
npm run build
```
Place the bundled web application in a folder named `public`, in the same folder as `jonitor.exe`.

## License
Jonitor is licensed under the [GPLv3](COPYING).
