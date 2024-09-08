import {
    getThemeLabelSelect,
    createLabel,
    createNumberInput,
    createHint,
    createTableHeader,
    createDialog,
    createDialogText,
    addEmptySensorTexts,
    formatValue,
} from "./util.ts";

import type { SensorInfo } from "./main.ts";

let state: "configure" | "configureEmpty" | "active" = "configure";
let hasConfiguredOnce = false;

let checkboxesList: HTMLInputElement[][] = []; // a list of checkboxes for every sensor/table
let tableConfigs: TableConfig[] = [];

let columnCount = 0; // 0 for auto number of columns
let tableWidth = 0; // 0 for auto width
let tableInfo: TableInfo[] = [];

// latest data to be used when reconfiguring tables, and creating tables right after configuring
let latestSensors: SensorInfo;
let latestValues: Float64Array;

const show = (sensors: SensorInfo, values: Float64Array) => {
    latestSensors = sensors;
    latestValues = values;

    configure(sensors);
};

const update = (sensors: SensorInfo, values: Float64Array) => {
    if (state === "configureEmpty") {
        latestSensors = sensors;
        latestValues = values;

        configure(sensors);

        return;
    }

    if (state !== "active") {
        latestSensors = sensors;
        latestValues = values;

        return;
    }

    latestValues = values;

    if (sensors.updatedCount !== latestSensors.updatedCount) {
        const result = checkTableInfo(sensors);

        if (result.hasChanged) {
            tableInfo = [];
            document.getElementById("container")!.remove();
            document.getElementById("footer")!.remove();

            createContainer(sensors, values, result.tableReadingsList, false);
        } else {
            const tableCount = tableInfo.length;

            for (let i = 0; i < tableCount; i++) {
                const table = tableInfo[i];
                table.valueIndices = result.tableReadingsList[i].valueIndices;

                updateCells(table, values);
            }
        }

        latestSensors = sensors;
    } else {
        const tableCount = tableInfo.length;

        for (let i = 0; i < tableCount; i++) {
            const table = tableInfo[i];

            updateCells(table, values);
        }
    }
};

const configure = (sensors: SensorInfo) => {
    if (sensors.sensors.length === 0) {
        if (state === "configureEmpty") {
            return;
        }

        state = "configureEmpty";

        const container = document.createElement("main");
        container.id = "container";

        addEmptySensorTexts(container, false);
        document.body.appendChild(container);

        return;
    }

    if (state === "configureEmpty") {
        document.getElementById("container")!.remove();
    }

    state = "configure";

    const container = document.createElement("main");
    container.id = "container";

    const topBar = document.createElement("div");
    topBar.classList.add("topbar");

    const title = document.createElement("h2");
    title.classList.add("topbar-title");
    title.textContent = "Configure tables";

    const buttonDone = document.createElement("button");
    buttonDone.classList.add("green-button");
    buttonDone.textContent = "Done";
    buttonDone.addEventListener("click", (ev) => {
        ev.stopPropagation();

        tableConfigs = [];

        for (let i = 0; i < sensors.sensors.length; i++) {
            const sensor = sensors.sensors[i];
            const checkboxes = checkboxesList[i];

            const selectedReadingIds = [];

            for (let j = 0; j < sensor.readings.length; j++) {
                if (checkboxes[j].checked) {
                    selectedReadingIds.push(sensor.readings[j].id);
                }
            }

            if (selectedReadingIds.length > 0) {
                tableConfigs.push({
                    sensorId: sensor.id,
                    sensorInstance: sensor.instance,
                    readingIds: selectedReadingIds,
                });
            }
        }

        if (tableConfigs.length === 0) {
            createDialog(
                "done-error-dialog",
                "No sensor selected",
                false,
                true,
                true,
                [createDialogText("Select one or more sensors")],
                [
                    {
                        id: null,
                        text: "Close",
                        isGreen: true,
                        autoFocus: true,
                        onClick: (close) => close(),
                    },
                ],
            );

            return;
        }

        checkboxesList = [];

        document.getElementById("container")!.remove();

        const result = checkTableInfo(latestSensors);

        createContainer(
            latestSensors,
            latestValues,
            result.tableReadingsList,
            true,
        );

        state = "active";

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                // scroll to top after the container is rendered
                window.scrollTo({ top: 0, behavior: "instant" });
            });
        });
    });

    topBar.appendChild(title);
    topBar.appendChild(buttonDone);

    const tablesContainer = document.createElement("div");
    tablesContainer.classList.add(
        "tables-container",
        "tables-container-configure",
    );

    for (let i = 0; i < sensors.sensors.length; i++) {
        const sensor = sensors.sensors[i];

        const card = document.createElement("div");
        card.classList.add("card");

        const tableNameGroup = document.createElement("div");
        tableNameGroup.classList.add("table-name-group");

        const tableName = document.createElement("h3");
        tableName.textContent = sensor.name;

        const toggle = document.createElement("button");
        toggle.id = `toggle${i}`;
        toggle.dataset.index = i.toString();
        toggle.addEventListener("click", onClickToggle);

        tableNameGroup.appendChild(tableName);
        tableNameGroup.appendChild(toggle);

        const table = document.createElement("table");

        const tHead = document.createElement("thead");

        const headRow = document.createElement("tr");
        headRow.appendChild(createTableHeader("Sensor", "col", []));
        headRow.appendChild(createTableHeader("Show", "col", ["text-center"]));

        tHead.appendChild(headRow);

        const tBody = document.createElement("tbody");

        const checkboxes = [];

        // get the list of selected readings for this sensor, used when reconfiguring tables
        let previousSelectedReadingIds: number[] | undefined;
        for (const tableConfig of tableConfigs) {
            if (
                tableConfig.sensorId === sensor.id &&
                tableConfig.sensorInstance === sensor.instance
            ) {
                previousSelectedReadingIds = tableConfig.readingIds;

                break;
            }
        }

        let state: "all_unchecked" | "all_checked" | "mixed" = "all_unchecked";

        for (let j = 0; j < sensor.readings.length; j++) {
            const reading = sensor.readings[j];

            // always checked when configuring tables for the first time
            const checked = hasConfiguredOnce
                ? previousSelectedReadingIds
                    ? previousSelectedReadingIds.includes(reading.id)
                    : false
                : true;

            const elementId = `reading-${i}-${j}`;

            // determine the text and action of the toggle button
            if (state !== "mixed") {
                if (checked && state === "all_unchecked") {
                    state = "mixed";
                } else if (!checked && state === "all_checked") {
                    state = "mixed";
                } else {
                    state = checked ? "all_checked" : "all_unchecked";
                }
            }

            const tr = document.createElement("tr");

            const th = document.createElement("th");
            th.id = elementId;
            th.scope = "row";
            th.textContent = reading.name;

            const td = document.createElement("td");
            td.classList.add("td-checkbox");

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = checked;
            checkbox.dataset.index = i.toString();
            checkbox.setAttribute("aria-labelledby", elementId);
            checkbox.addEventListener("change", onChangeListener);

            checkboxes.push(checkbox);

            td.appendChild(checkbox);

            tr.appendChild(th);
            tr.appendChild(td);

            tBody.appendChild(tr);
        }

        checkboxesList.push(checkboxes);

        toggle.textContent =
            state === "all_unchecked" ? "Show all" : "Hide all";

        table.appendChild(tHead);
        table.appendChild(tBody);

        card.appendChild(tableNameGroup);
        card.appendChild(table);

        tablesContainer.appendChild(card);
    }

    container.append(topBar);
    container.appendChild(tablesContainer);

    hasConfiguredOnce = true;
    tableConfigs = [];

    document.body.appendChild(container);

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            // scroll to top after the container is rendered
            window.scrollTo({ top: 0 });
        });
    });
};

const onClickToggle = (ev: MouseEvent) => {
    ev.stopPropagation();

    const e = ev.currentTarget as HTMLElement;

    let newState;
    let newText;

    // button action is determined by its text
    if (e.textContent === "Hide all") {
        newState = false;
        newText = "Show all";
    } else {
        newState = true;
        newText = "Hide all";
    }

    const checkboxes = checkboxesList[Number(e.dataset.index)];

    for (const checkbox of checkboxes) {
        checkbox.checked = newState;
    }

    e.textContent = newText;
};

const onChangeListener = (ev: Event) => {
    ev.stopPropagation();

    const e = ev.currentTarget as HTMLInputElement;
    const index = Number(e.dataset.index);
    const checkboxes = checkboxesList[index];

    let state: "all_unchecked" | "all_checked" | "mixed" = checkboxes[0].checked
        ? "all_checked"
        : "all_unchecked";

    // check if all checkboxes have the same checked state
    for (let i = 1; i < checkboxes.length; i++) {
        const checked = checkboxes[i].checked;

        if (checked && state === "all_unchecked") {
            state = "mixed";

            break;
        } else if (!checked && state === "all_checked") {
            state = "mixed";

            break;
        }
    }

    if (state === "all_unchecked") {
        document.getElementById(`toggle${index}`)!.textContent = "Show all";
    } else if (state === "all_checked") {
        document.getElementById(`toggle${index}`)!.textContent = "Hide all";
    }
};

/**
 * Checks if the sensors and value indices are still valid.
 */
const checkTableInfo = (
    sensors: SensorInfo,
): {
    hasChanged: boolean;
    tableReadingsList: TableReadings[];
} => {
    let hasChanged = false;

    const tableReadingsList: TableReadings[] = [];

    let tableInfoIndex = 0;

    // eslint-disable-next-line @typescript-eslint/prefer-for-of
    for (let i = 0; i < sensors.sensors.length; i++) {
        const sensor = sensors.sensors[i];

        const tableConfig = tableConfigs.find(
            (v) =>
                v.sensorId === sensor.id &&
                v.sensorInstance === sensor.instance,
        );

        // check if readings of this sensor are configured to be shown
        if (!tableConfig) {
            continue;
        }

        let oldTableInfo: TableInfo | null = tableInfo[tableInfoIndex];

        // check if the TableInfo is for the correct sensor
        if (
            oldTableInfo &&
            (oldTableInfo.sensorId !== sensor.id ||
                oldTableInfo.sensorInstance !== sensor.instance)
        ) {
            oldTableInfo = null;
        }

        const newReadingIds = [];
        const newValueIndices = [];
        const newUnits = [];

        // store the latest values to compare with the old values later
        for (let j = 0; j < sensor.readings.length; j++) {
            const reading = sensor.readings[j];

            if (tableConfig.readingIds.includes(reading.id)) {
                newReadingIds.push(reading.id);
                newValueIndices.push(sensor.offset + j * 2);
                newValueIndices.push(sensor.offset + j * 2 + 1);
                newUnits.push(reading.unit);
            }
        }

        if (!oldTableInfo) {
            hasChanged = true;
        } else if (!hasChanged) {
            if (newReadingIds.length !== oldTableInfo.readingIds.length) {
                hasChanged = true;
            } else {
                // compare the old values with the new values

                for (let j = 0; j < newReadingIds.length; j++) {
                    if (newReadingIds[j] !== oldTableInfo.readingIds[j]) {
                        hasChanged = true;

                        break;
                    }

                    if (
                        newValueIndices[j * 2] !==
                        oldTableInfo.valueIndices[j * 2]
                    ) {
                        hasChanged = true;

                        break;
                    }

                    if (
                        newValueIndices[j * 2 + 1] !==
                        oldTableInfo.valueIndices[j * 2 + 1]
                    ) {
                        hasChanged = true;

                        break;
                    }
                }
            }
        }

        tableReadingsList.push({
            sensorId: sensor.id,
            sensorInstance: sensor.instance,
            readingIds: newReadingIds,
            valueIndices: newValueIndices,
            units: newUnits,
        });

        tableInfoIndex += 1;
    }

    if (tableReadingsList.length !== tableInfo.length) {
        hasChanged = true;
    }

    return {
        hasChanged,
        tableReadingsList,
    };
};

const createContainer = (
    sensors: SensorInfo,
    values: Float64Array,
    tableReadingsList: TableReadings[],
    animate: boolean,
) => {
    const container = document.createElement("main");
    container.id = "container";

    if (tableReadingsList.length > 0) {
        container.classList.add("tables-container");

        if (!animate) {
            container.classList.add("no-fade-in");
        }

        if (columnCount !== 0) {
            container.style.columnCount = columnCount.toString();
        }

        for (const tableReadings of tableReadingsList) {
            const sensor = sensors.sensors.find(
                (v) =>
                    v.id === tableReadings.sensorId &&
                    v.instance === tableReadings.sensorInstance,
            )!;

            const card = document.createElement("div");
            card.classList.add("card");

            if (tableWidth !== 0) {
                card.style.width = `${tableWidth}px`;
            }

            const tableName = document.createElement("h3");
            tableName.classList.add("table-name");
            tableName.textContent = sensor.name;

            const table = document.createElement("table");
            table.classList.add("table-layout");

            const tHead = document.createElement("thead");

            const headRow = document.createElement("tr");
            headRow.appendChild(createTableHeader("Sensor", "col", []));
            headRow.appendChild(
                createTableHeader("Current", "col", [
                    "text-right",
                    "value-cell",
                ]),
            );
            headRow.appendChild(
                createTableHeader("Maximum", "col", [
                    "text-right",
                    "value-cell",
                ]),
            );

            tHead.appendChild(headRow);

            const tBody = document.createElement("tbody");

            const cells = [];
            const lastValues = [];

            for (let i = 0; i < tableReadings.readingIds.length; i++) {
                const readingId = tableReadings.readingIds[i];

                const readingName = sensor.readings.find(
                    (v) => v.id === readingId,
                )!.name;
                const currentValueIndex = tableReadings.valueIndices[i * 2];
                const currentValue = values[currentValueIndex];
                const maxValue = values[currentValueIndex + 1];
                const unit = tableReadings.units[i];

                const tr = document.createElement("tr");

                const th = document.createElement("th");
                th.scope = "row";
                th.textContent = readingName;

                const tdCurrent = document.createElement("td");
                tdCurrent.textContent = formatValue(currentValue, unit);

                const tdMaximum = document.createElement("td");
                tdMaximum.textContent = formatValue(maxValue, unit);

                lastValues.push(currentValue, maxValue);
                cells.push(tdCurrent, tdMaximum);

                tr.appendChild(th);
                tr.appendChild(tdCurrent);
                tr.appendChild(tdMaximum);

                tBody.appendChild(tr);
            }

            table.appendChild(tHead);
            table.appendChild(tBody);

            card.appendChild(tableName);
            card.appendChild(table);

            container.appendChild(card);

            tableInfo.push({
                card,
                cells,
                sensorId: sensor.id,
                sensorInstance: sensor.instance,
                readingIds: tableReadings.readingIds,
                valueIndices: tableReadings.valueIndices,
                units: tableReadings.units,
                lastValues,
            });
        }
    } else {
        addEmptySensorTexts(container, true);
    }

    const footer = (
        document.getElementById("footer-template") as HTMLTemplateElement
    ).content.cloneNode(true) as HTMLElement;

    const footerSettings = footer.querySelector("#footer-settings")!;
    footerSettings.addEventListener("click", (ev) => {
        ev.stopPropagation();

        const labelColumns = createLabel(
            "Tables per row",
            "columns-input",
            false,
        );

        const inputColumns = createNumberInput(
            "columns-input",
            "auto",
            "columns-hint",
        );

        if (columnCount !== 0) {
            inputColumns.value = columnCount.toString();
        }

        const hintColumnsText =
            "Set the number of tables per row. Leave the field blank for automatic number of columns based on screen size.";

        const hintColumns = createHint("columns-hint", hintColumnsText);

        const labelWidth = createLabel(
            "Table width (pixels)",
            "width-input",
            false,
        );

        const inputWidth = createNumberInput(
            "width-input",
            "auto",
            "width-hint",
        );
        if (tableWidth !== 0) {
            inputWidth.value = tableWidth.toString();
        }

        const hintWidthText =
            "Set the width of every table. Leave the field blank for automatic width.";

        const hintWidth = createHint("width-hint", hintWidthText);

        createDialog(
            "tables-dialog",
            "Settings",
            false,
            true,
            true,
            [
                ...getThemeLabelSelect(),
                labelColumns,
                inputColumns,
                hintColumns,
                labelWidth,
                inputWidth,
                hintWidth,
            ],
            [
                {
                    id: null,
                    text: "Configure tables",
                    isGreen: false,
                    autoFocus: false,
                    onClick: (close) => {
                        tableInfo = [];

                        close();

                        document.getElementById("container")!.remove();
                        document.getElementById("footer")!.remove();

                        configure(latestSensors);
                    },
                },
                {
                    id: null,
                    text: "Save",
                    isGreen: true,
                    autoFocus: true,
                    onClick: (close) => {
                        let hasError = false;

                        const columnsString = inputColumns.value.trim();
                        const columnsNumber = Number(columnsString);

                        // input can be empty, or an integer between 1 and 10 inclusive
                        if (
                            Number.isNaN(columnsNumber) ||
                            !Number.isInteger(columnsNumber) ||
                            (columnsString &&
                                (columnsNumber < 1 || columnsNumber > 10))
                        ) {
                            inputColumns.classList.add("error");
                            hintColumns.classList.add("error");
                            hintColumns.textContent =
                                "The number must be between 1 and 10 inclusive";

                            hasError = true;
                        } else {
                            inputColumns.classList.remove("error");
                            hintColumns.classList.remove("error");
                            hintColumns.textContent = hintColumnsText;
                        }

                        const widthString = inputWidth.value.trim();
                        const widthNumber = Number(widthString);
                        if (
                            Number.isNaN(widthNumber) ||
                            !Number.isInteger(widthNumber) ||
                            (widthString && widthNumber < 300)
                        ) {
                            inputWidth.classList.add("error");
                            hintWidth.classList.add("error");
                            hintWidth.textContent =
                                "The width must be at least 300";

                            hasError = true;
                        } else {
                            inputWidth.classList.remove("error");
                            hintWidth.classList.remove("error");
                            hintWidth.textContent = hintWidthText;
                        }

                        if (!hasError) {
                            if (columnCount !== columnsNumber) {
                                columnCount = columnsNumber;

                                if (columnCount === 0) {
                                    document
                                        .getElementById("container")!
                                        .style.removeProperty("column-count");
                                } else {
                                    document.getElementById(
                                        "container",
                                    )!.style.columnCount =
                                        columnCount.toString();
                                }
                            }

                            if (tableWidth !== widthNumber) {
                                tableWidth = widthNumber;

                                if (tableWidth === 0) {
                                    for (const table of tableInfo) {
                                        table.card.style.removeProperty(
                                            "width",
                                        );
                                    }
                                } else {
                                    const newWidth = `${tableWidth}px`;

                                    for (const table of tableInfo) {
                                        table.card.style.width = newWidth;
                                    }
                                }
                            }

                            close();
                        }
                    },
                },
            ],
        );
    });

    document.body.appendChild(container);
    document.body.appendChild(footer);
};

const updateCells = (table: TableInfo, values: Float64Array) => {
    const valueIndexCount = table.valueIndices.length;

    for (let i = 0; i < valueIndexCount; i++) {
        const index = table.valueIndices[i];
        const value = values[index];

        if (table.lastValues[i] !== value) {
            // ~~ rounds down and return an integer
            // length of units[] is half of cells[] since cells[] stores the current value and
            // maximum value
            table.cells[i].textContent = formatValue(
                value,
                table.units[~~(i / 2)],
            );
            table.lastValues[i] = value;
        }
    }
};

export { show, update };

interface TableConfig {
    sensorId: number;
    sensorInstance: number;
    readingIds: number[];
}

interface TableInfo {
    card: HTMLDivElement;
    cells: HTMLTableCellElement[];
    sensorId: number;
    sensorInstance: number;
    readingIds: number[];
    valueIndices: number[];
    units: string[];
    lastValues: number[];
}

interface TableReadings {
    sensorId: number;
    sensorInstance: number;
    readingIds: number[];
    valueIndices: number[];
    units: string[];
}
