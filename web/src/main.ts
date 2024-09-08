import {
    configureThemeSelect,
    createDialog,
    createDialogText,
} from "./util.ts";

const wsProtocol = window.location.protocol === "http:" ? "ws:" : "wss:";
const wsUrl = `${wsProtocol}//${window.location.host}/data`;

let lastPollTime = 0n;
let sensors: SensorInfo;
let lastSensorsUpdatedCount = 0n;
let isDialogShowing = false;

// the number 305419896 on little endian platform is 0x78 0x56 0x23 0x12
const isLittleEndian =
    new Uint8Array(new Uint32Array([305419896]).buffer)[0] === Number("0x78");

const ws = new WebSocket(wsUrl);
ws.binaryType = "arraybuffer";

ws.addEventListener("open", (_) => {
    console.log("Websocket connected");
});

ws.addEventListener("close", (e) => {
    console.log("Websocket closed");

    if (!isDialogShowing) {
        createDialog(
            "main-dialog",
            "Connection closed",
            false,
            true,
            true,
            [createDialogText(e.reason)],
            [],
        );
    }
});

ws.addEventListener("error", (_) => {
    console.error("Websocket error");

    createDialog(
        "main-dialog",
        "Error",
        false,
        true,
        true,
        [
            createDialogText(
                "Failed to read data. Refresh this page to reconnect.",
            ),
        ],
        [],
    );

    isDialogShowing = true;
});

ws.addEventListener("message", async (e) => {
    if (e.data instanceof ArrayBuffer) {
        // data is in little endian
        const view = new DataView(e.data);

        const pollTime = view.getBigInt64(0, true);
        const sensorsUpdatedCount = view.getBigUint64(8, true);

        if (pollTime === lastPollTime) {
            return;
        }

        lastPollTime = pollTime;

        if (sensorsUpdatedCount !== lastSensorsUpdatedCount) {
            try {
                const response = await fetch("/sensors");
                if (!response.ok) {
                    console.error(
                        `/sensors returned status ${response.status}`,
                    );
                    return;
                }

                sensors = await response.json();
                sensors.updatedCount = BigInt(sensors.updatedCount);
                lastSensorsUpdatedCount = sensors.updatedCount;
            } catch (e) {
                console.error(e);
            }
        }

        if (isLittleEndian) {
            const values = new Float64Array(e.data);

            update(values);
        } else {
            const length = view.byteLength / 8;
            const values = new Float64Array(length);

            // convert from little endian to big endian
            for (let i = 0; i < length; i++) {
                values[i] = view.getFloat64(16 + i * 8, false);
            }

            update(values);
        }
    }
});

let currentView: "loading" | "configure" | "tables" | "charts" = "loading";
let tables: typeof import("./tables.js");
let charts: typeof import("./charts.js");

const update = (values: Float64Array) => {
    if (currentView === "loading") {
        currentView = "configure";

        document.getElementById("loader")!.classList.add("display-none");

        const container = document.getElementById("main-container")!;
        container.classList.remove("display-none");

        const tablesButton = document.getElementById("tables-button")!;
        const chartsButton = document.getElementById("charts-button")!;

        tablesButton.addEventListener("click", (ev) => {
            ev.stopPropagation();

            container.remove();

            const timeoutId = setTimeout(() => {
                // show the loader if tables.js has not loaded after 1 second
                document
                    .getElementById("loader")!
                    .classList.remove("display-none");
            }, 1000);

            import("./tables.js")
                .then((module) => {
                    currentView = "tables";
                    tables = module;

                    clearTimeout(timeoutId);

                    document.getElementById("loader")!.remove();

                    tables.show(sensors, values);

                    window.location.hash = "tables";
                })
                .catch((e) => {
                    console.error(e);
                });
        });

        chartsButton.addEventListener("click", (ev) => {
            ev.stopPropagation();

            container.remove();

            const timeoutId = setTimeout(() => {
                // show the loader if charts.js has not loaded after 1 second
                document
                    .getElementById("loader")!
                    .classList.remove("display-none");
            }, 1000);

            import("./charts.js")
                .then((module) => {
                    currentView = "charts";
                    charts = module;

                    clearTimeout(timeoutId);

                    document.getElementById("loader")!.remove();

                    charts.show(sensors, values, Number(lastPollTime) * 1000);

                    window.location.hash = "charts";
                })
                .catch((e) => {
                    console.error(e);
                });
        });

        const locationHash = window.location.hash;

        // a simple client side routing implementation
        if (locationHash === "#tables") {
            tablesButton.click();
        } else if (locationHash === "#charts") {
            chartsButton.click();
        } else {
            const themeSelect = document.getElementById(
                "theme-select",
            ) as HTMLSelectElement;

            configureThemeSelect(themeSelect);
        }
    } else if (currentView === "tables") {
        tables.update(sensors, values);
    } else if (currentView === "charts") {
        charts.update(sensors, values, Number(lastPollTime) * 1000);
    }
};

setTimeout(() => {
    if (currentView === "loading") {
        // show the loader if the websocket has not received data after 1 second
        document.getElementById("loader")!.classList.remove("display-none");
    }
}, 1000);

window.addEventListener("hashchange", (ev) => {
    const newUrl = new URL(ev.newURL);

    // Changing `window.location.hash` adds an entry to the browser history. When navigating between
    // history entries, the page does not reload if only the URL fragment is changing. The
    // hashchange event is called when `window.location.hash` is set to a value so the below check
    // is necessary.
    if (newUrl.hash !== `#${currentView}`) {
        window.location.reload();
    }
});

export interface SensorInfo {
    updatedCount: bigint;
    sensors: {
        id: number;
        instance: number;
        name: string;
        readings: {
            id: number;
            name: string;
            unit: string;
        }[];
        offset: number;
    }[];
}
