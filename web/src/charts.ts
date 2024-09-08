import {
    getThemeLabelSelect,
    createSelectOption,
    createLabel,
    createNumberInput,
    createHint,
    createTableHeader,
    createDialog,
    showDialog,
    createDialogText,
    addEmptySensorTexts,
    formatValue,
} from "./util.ts";
import {
    _adapters as chartAdapters,
    Chart,
    Tooltip,
    Legend,
    BarController,
    BarElement,
    CategoryScale,
    LinearScale,
    LineController,
    LineElement,
    PointElement,
    TimeSeriesScale,
    DoughnutController,
    ArcElement,
} from "chart.js";

import imgAddUrl from "./assets/add.svg";
import imgUploadUrl from "./assets/upload.svg";
import imgHelpUrl from "./assets/help.svg";
import imgGridUrl from "./assets/grid.svg";
import imgUpUrl from "./assets/up.svg";
import imgDownUrl from "./assets/down.svg";
import imgDeleteUrl from "./assets/delete.svg";
import imgMoreUrl from "./assets/more.svg";

import type { SensorInfo } from "./main.ts";
import type {
    TooltipPositionerFunction,
    ChartType,
    LegendItem,
    Point,
} from "chart.js";

let state: "configure" | "configureEmpty" | "active" = "configure";

// the config being edited, for onClick listeners to refer to
let currentGroupConfigIndex = 0;
let currentConfigIndex = 0;
let currentConfig: ChartConfig = null!;
let currentConfigChartAction: "add" | "edit" = "add";

// increment to get unique ID for chart title <h3>
let chartTitleIdIndex = 0;

let chartGroupConfigs: ChartGroupConfigWithRefs[] = [];
let addedSensorButtonGroups: {
    color: HTMLInputElement;
    up: HTMLButtonElement;
    down: HTMLButtonElement;
    delete: HTMLButtonElement;
}[] = [];

let chartGroupInfo: ChartGroupInfo[] = [];

// store group config temporarily when state is configureEmpty
let configureGroupConfigs: ChartGroupConfig[] = [];

// sensors for the current configure session to allow consistency
let currentSensors: SensorInfo | null = null;

// latest data to be used when reconfiguring charts, and creating charts right after configuring
let latestSensors: SensorInfo;
let latestValues: Float64Array;
let latestPollTime: number;

const hintSensorText = "Every sensor in a chart must have the same unit";

let preferReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
).matches;

// from https://www.patternfly.org/charts/colors-for-charts/
const colors = [
    "#0066cc",
    "#4cb140",
    "#009596",
    "#5752d1",
    "#f4c145",
    "#ec7a08",
    "#7d1007",
    "#b8bbbe",
    "#8bc1f7",
    "#bde2b9",
    "#a2d9d9",
    "#b2b0ea",
    "#f9e0a2",
    "#f4b678",
    "#c9190b",
    "#f0f0f0",
    "#002f5d",
    "#23511e",
    "#003737",
    "#2a265f",
    "#c58c00",
    "#8f4700",
    "#2c0000",
    "#6a6e73",
    "#519de9",
    "#7cc674",
    "#73c5c5",
    "#8481dd",
    "#f6d173",
    "#ef9234",
    "#a30000",
    "#d2d2d2",
    "#004b95",
    "#38812f",
    "#005f60",
    "#3c3d99",
    "#f0ab00",
    "#c46100",
    "#470000",
    "#8a8d90",
];

const getChartColors = (): {
    text: string;
    background: string;
    border: string;
    tooltipBackground: string;
    tooltipText: string;
} => {
    const style = window.getComputedStyle(document.body);

    return {
        text: style.getPropertyValue("--chart-text-color"),
        background: style.getPropertyValue("--chart-background-color"),
        border: style.getPropertyValue("--chart-border-color"),
        tooltipBackground: style.getPropertyValue(
            "--chart-tooltip-background-color",
        ),
        tooltipText: style.getPropertyValue("--chart-tooltip-text-color"),
    };
};

let {
    text: chartTextColor,
    background: chartBackgroundColor,
    border: chartBorderColor,
    tooltipBackground: chartTooltipBackgroundColor,
    tooltipText: chartTooltipTextColor,
} = getChartColors();

Chart.register(
    Tooltip,
    Legend,
    BarController,
    BarElement,
    CategoryScale,
    LinearScale,
    LineController,
    LineElement,
    PointElement,
    TimeSeriesScale,
    DoughnutController,
    ArcElement,
);

let cachedTimestamp = 0;
let cachedFormattedTimestamp = "";

chartAdapters._date.override({
    formats: () => {
        return {};
    },
    format: (timestamp, _) => {
        // return cached result as this function is sometimes called repeatedly with the same timestamp
        if (timestamp === cachedTimestamp) {
            return cachedFormattedTimestamp;
        }

        cachedTimestamp = timestamp;

        const date = new Date(timestamp);
        const hours = date.getHours();
        const minutes = date.getMinutes();
        const seconds = date.getSeconds();

        cachedFormattedTimestamp = `${hours > 9 ? hours : "0" + hours}:${minutes > 9 ? minutes : "0" + minutes}:${seconds > 9 ? seconds : "0" + seconds}`;

        return cachedFormattedTimestamp;
    },
});

Tooltip.positioners.middle = function (items, _) {
    if (items.length === 0) {
        return false;
    }

    const chartArea = this.chart.chartArea;

    return {
        x: items[0].element.x,
        y: (chartArea.top + chartArea.bottom) / 2,
    };
};

const show = (
    sensors: SensorInfo,
    values: Float64Array,
    lastPollTime: number,
) => {
    currentSensors = sensors;
    latestSensors = sensors;
    latestValues = values;
    latestPollTime = lastPollTime;

    configure(sensors, []);
};

const update = (
    sensors: SensorInfo,
    values: Float64Array,
    lastPollTime: number,
) => {
    latestValues = values;
    latestPollTime = lastPollTime;

    if (state === "configure") {
        latestSensors = sensors;

        return;
    }

    if (state === "configureEmpty") {
        currentSensors = sensors;
        latestSensors = sensors;

        configure(sensors, configureGroupConfigs);

        return;
    }

    if (state !== "active") {
        return;
    }

    if (sensors.updatedCount !== latestSensors.updatedCount) {
        updateIndices(sensors);

        latestSensors = sensors;
    }

    const groupCount = chartGroupInfo.length;

    for (let i = 0; i < groupCount; i++) {
        const group = chartGroupInfo[i];
        const chartCount = group.charts.length;

        for (let j = 0; j < chartCount; j++) {
            const chart = group.charts[j];
            const datasetCount = chart.datasets.length;

            if (chart.chartType === "bar") {
                let yAxisMax = chart.yAxisMax;
                const unit = chart.datasets[0].unit;

                const chartData = chart.chart.data.datasets[0].data;
                for (let k = 0; k < datasetCount; k++) {
                    const index = chart.indices[k];

                    if (index === -1) {
                        chartData[k].y = NaN;

                        continue;
                    }

                    chartData[k].y = values[index];

                    const maxValue = values[index + 1];
                    if (yAxisMax < maxValue) {
                        yAxisMax = maxValue;
                    }
                }

                if (unit === "%") {
                    chart.chart.options.scales!.y!.max = 100;
                } else if (unit === "°C" && yAxisMax <= 100) {
                    chart.chart.options.scales!.y!.max = 100;
                } else if (unit === "°F") {
                    chart.chart.options.scales!.y!.min = 32;
                    if (yAxisMax <= 212) {
                        chart.chart.options.scales!.y!.max = 212;
                    } else {
                        if (chart.yAxisMax !== yAxisMax) {
                            chart.yAxisMax = yAxisMax;

                            chart.chart.options.scales!.y!.max = yAxisMax;
                        }
                    }
                } else {
                    if (chart.yAxisMax !== yAxisMax) {
                        chart.yAxisMax = yAxisMax;

                        chart.chart.options.scales!.y!.max = yAxisMax;
                    }
                }

                chart.chart.update();
            } else if (chart.chartType === "line") {
                let yAxisMax = chart.yAxisMax;
                const unit = chart.datasets[0].unit;

                for (let k = 0; k < datasetCount; k++) {
                    const index = chart.indices[k];
                    const chartData = chart.chart.data.datasets[k].data;

                    // remove the first data, and add the new data to the back
                    chartData.shift();

                    if (index === -1) {
                        chartData.push({
                            x: lastPollTime,
                            y: NaN,
                        });

                        continue;
                    }

                    chartData.push({
                        x: lastPollTime,
                        y: values[index],
                    });

                    const maxValue = values[index + 1];
                    if (yAxisMax < maxValue) {
                        yAxisMax = maxValue;
                    }
                }

                if (unit === "%") {
                    chart.chart.options.scales!.y!.max = 100;
                } else if (unit === "°C" && yAxisMax <= 100) {
                    chart.chart.options.scales!.y!.max = 100;
                } else if (unit === "°F") {
                    chart.chart.options.scales!.y!.min = 32;
                    if (yAxisMax <= 212) {
                        chart.chart.options.scales!.y!.max = 212;
                    } else {
                        if (chart.yAxisMax !== yAxisMax) {
                            chart.yAxisMax = yAxisMax;

                            chart.chart.options.scales!.y!.max = yAxisMax;
                        }
                    }
                } else {
                    if (chart.yAxisMax !== yAxisMax) {
                        chart.yAxisMax = yAxisMax;

                        chart.chart.options.scales!.y!.max = yAxisMax;
                    }
                }

                chart.chart.update();
            } else if (chart.chartType === "gauge") {
                const index = chart.indices[0];
                const chartData = chart.chart.data.datasets[0].data;

                if (index === -1) {
                    chartData[0] = NaN;
                    chartData[1] = chart.maximumValue;
                } else {
                    const currentValue = values[index];

                    // use max value from HWiNFO if max value from user is wrong
                    let maxValue = chart.maximumValue - currentValue;
                    if (maxValue <= 0) {
                        maxValue = values[index + 1];
                    }

                    chartData[0] = currentValue;
                    chartData[1] = maxValue;
                }

                chart.chart.update();
            } else if (chart.chartType === "table") {
                for (let k = 0; k < datasetCount; k++) {
                    const index = chart.indices[k];

                    if (index === -1) {
                        // only update the current value cell
                        chart.cells[k * 2].textContent = "-";
                        chart.lastValues[k * 2] = -1;

                        continue;
                    }

                    const unit = chart.datasets[k].unit;
                    const currentValue = values[index];
                    const maxValue = values[index + 1];

                    if (chart.lastValues[k * 2] !== currentValue) {
                        chart.cells[k * 2].textContent = formatValue(
                            currentValue,
                            unit,
                        );
                        chart.lastValues[k * 2] = currentValue;
                    }

                    if (chart.lastValues[k * 2 + 1] !== maxValue) {
                        chart.cells[k * 2 + 1].textContent = formatValue(
                            maxValue,
                            unit,
                        );
                        chart.lastValues[k * 2 + 1] = maxValue;
                    }
                }
            }
        }
    }
};

const configure = (sensors: SensorInfo, groupConfigs: ChartGroupConfig[]) => {
    const container = document.createElement("main");
    container.id = "container";

    if (sensors.sensors.length === 0) {
        if (state === "configureEmpty") {
            return;
        }

        state = "configureEmpty";
        configureGroupConfigs = groupConfigs;

        addEmptySensorTexts(container, false);
        document.body.appendChild(container);

        return;
    }

    if (state === "configureEmpty") {
        configureGroupConfigs = [];

        document.getElementById("container")!.remove();
    }

    state = "configure";

    const topBar = document.createElement("div");
    topBar.classList.add("topbar");

    const title = document.createElement("h2");
    title.classList.add("topbar-title");
    title.textContent = "Configure charts";

    const buttonDone = document.createElement("button");
    buttonDone.classList.add("green-button");
    buttonDone.textContent = "Done";
    buttonDone.disabled = true;
    buttonDone.addEventListener("click", (ev) => {
        ev.stopPropagation();

        let hasError = false;
        let errorElement: Element | undefined;

        for (const groupConfig of chartGroupConfigs) {
            if (groupConfig.chartConfigs.length === 0) {
                groupConfig.card.classList.add("error");

                if (!hasError) {
                    errorElement = groupConfig.container;
                }

                hasError = true;
            }
        }

        if (hasError) {
            createDialog(
                "done-error-dialog",
                "No chart added to the group",
                false,
                true,
                true,
                [
                    createDialogText(
                        "Every group needs to have one or more charts. Delete the group if it is not needed.",
                    ),
                ],
                [
                    {
                        id: null,
                        text: "Close",
                        isGreen: true,
                        autoFocus: true,
                        onClick: (close) => {
                            close();

                            errorElement!.scrollIntoView();
                        },
                    },
                ],
            );

            return;
        }

        const newContainer = document.createElement("main");
        newContainer.id = "container";
        newContainer.classList.add("charts-container");

        const screenWidth = getScreenWidth();

        for (const groupConfig of chartGroupConfigs) {
            const gridContainer = document.createElement("div");
            gridContainer.classList.add("chart-grid-container");

            configureGrid(
                gridContainer,
                groupConfig.gridBreakpoints,
                screenWidth,
            );

            chartGroupInfo.push({
                container: gridContainer,
                gridBreakpoints: groupConfig.gridBreakpoints,
                charts: [],
            });

            for (const chartConfig of groupConfig.chartConfigs) {
                // remove the preview chart
                chartConfig.chart?.destroy();

                gridContainer.appendChild(
                    createChartContainer(
                        chartConfig,
                        chartGroupInfo.length - 1,
                        false,
                        0,
                    ),
                );
            }

            newContainer.appendChild(gridContainer);
        }

        chartGroupConfigs = [];

        const footer = (
            document.getElementById("footer-template") as HTMLTemplateElement
        ).content.cloneNode(true) as HTMLElement;

        const footerSettings = footer.querySelector("#footer-settings")!;
        footerSettings.addEventListener("click", (ev) => {
            ev.stopPropagation();

            const [labelTheme, selectTheme] = getThemeLabelSelect();
            selectTheme.addEventListener("change", (ev) => {
                ev.stopPropagation();

                updateChartColors();
            });

            const buttonDownload = document.createElement("button");
            buttonDownload.id = "download-button";
            buttonDownload.textContent = "Download config";
            buttonDownload.setAttribute("aria-describedby", "download-hint");
            buttonDownload.addEventListener("click", (ev) => {
                ev.stopPropagation();

                const groupConfigs: ChartGroupConfig[] = chartGroupInfo.map(
                    (group) => {
                        return {
                            gridBreakpoints: group.gridBreakpoints,
                            chartConfigs: group.charts.map((value) => {
                                return {
                                    title: value.title,
                                    chartType: value.chartType,
                                    dataCount: value.dataCount,
                                    maximumValue: value.maximumValue,
                                    height: value.height,
                                    animationDuration: value.animationDuration,
                                    showLegend: value.showLegend,
                                    showLabels: value.showLabels,
                                    autoColors: value.autoColors,
                                    datasets: value.datasets,
                                };
                            }),
                        };
                    },
                );

                // create an anchor element with data URI, the browser will save the content
                // as a file when the element is clicked
                const anchor = document.createElement("a");
                anchor.setAttribute(
                    "href",
                    URL.createObjectURL(
                        new Blob([JSON.stringify(groupConfigs, null, 4)], {
                            type: "application/json",
                        }),
                    ),
                );
                anchor.setAttribute("download", "config.json");
                anchor.click(); // click the element

                // close the dialog
                (
                    document.getElementById(
                        "charts-dialog-save-button",
                    ) as HTMLButtonElement
                ).click();
            });

            const hintDownload = createHint(
                "download-hint",
                `The downloaded file can be renamed, but the file extension must not be changed.
                    Place the config file in \`\\public\\configs\`.`,
            );

            createDialog(
                "charts-dialog",
                "Settings",
                false,
                true,
                true,
                [labelTheme, selectTheme, buttonDownload, hintDownload],
                [
                    {
                        id: null,
                        text: "Configure charts",
                        isGreen: false,
                        autoFocus: false,
                        onClick: (close) => {
                            const groupConfigs: ChartGroupConfig[] = [];

                            for (const group of chartGroupInfo) {
                                for (const chart of group.charts) {
                                    if (
                                        chart.chartType === "bar" ||
                                        chart.chartType === "line" ||
                                        chart.chartType === "gauge"
                                    ) {
                                        chart.chart.destroy();
                                    }
                                }

                                groupConfigs.push({
                                    gridBreakpoints: group.gridBreakpoints,
                                    chartConfigs: group.charts.map((value) => {
                                        return {
                                            title: value.title,
                                            chartType: value.chartType,
                                            dataCount: value.dataCount,
                                            maximumValue: value.maximumValue,
                                            height: value.height,
                                            animationDuration:
                                                value.animationDuration,
                                            showLegend: value.showLegend,
                                            showLabels: value.showLabels,
                                            autoColors: value.autoColors,
                                            datasets: value.datasets,
                                        };
                                    }),
                                });
                            }

                            chartGroupInfo = [];

                            close();
                            document.getElementById("container")!.remove();
                            document.getElementById("footer")!.remove();

                            currentSensors = latestSensors;

                            configure(latestSensors, groupConfigs);
                        },
                    },
                    {
                        id: "charts-dialog-save-button",
                        text: "Save",
                        isGreen: true,
                        autoFocus: true,
                        onClick: (close) => close(),
                    },
                ],
            );
        });

        container.remove();
        document.getElementById("help-dialog")!.remove();
        document.getElementById("configure-grid-dialog")!.remove();
        document.getElementById("configure-chart-dialog")!.remove();

        document.body.appendChild(newContainer);
        document.body.appendChild(footer);

        state = "active";
        currentSensors = null;

        updateIndices(latestSensors);
        update(latestSensors, latestValues, latestPollTime);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                // scroll to top after the container is rendered
                window.scrollTo({ top: 0, behavior: "instant" });
            });
        });
    });

    topBar.appendChild(title);
    topBar.appendChild(buttonDone);

    // button group with add and load buttons

    const divBigButtonGroup = document.createElement("div");
    divBigButtonGroup.id = "add-load-buttons";
    divBigButtonGroup.classList.add("button-big-group");

    const buttonAddChart = document.createElement("button");
    buttonAddChart.classList.add("button-big");
    buttonAddChart.addEventListener("click", (ev) => {
        ev.stopPropagation();

        buttonDone.disabled = false;
        divBigButtonGroup.remove();
        buttonAddGroup.classList.remove("display-none");

        if (groupConfigs.length === 0) {
            buttonAddGroup.before(createGroupConfigContainer(null));
        } else {
            for (const groupConfig of groupConfigs) {
                buttonAddGroup.before(createGroupConfigContainer(groupConfig));
            }
        }
    });

    const imgAddChart = document.createElement("img");
    imgAddChart.src = imgAddUrl;
    imgAddChart.ariaHidden = "true";

    const textAddChart = document.createElement("span");
    textAddChart.textContent = "Add charts";

    buttonAddChart.appendChild(imgAddChart);
    buttonAddChart.appendChild(textAddChart);

    const buttonLoad = document.createElement("button");
    buttonLoad.classList.add("button-big");
    buttonLoad.addEventListener("click", (ev) => {
        ev.stopPropagation();

        const labelConfig = createLabel(
            "Config file name (without .json extension)",
            "config-input",
            true,
        );

        const inputConfig = document.createElement("input");
        inputConfig.id = "config-input";
        inputConfig.type = "text";
        inputConfig.setAttribute("aria-describedby", "config-hint");
        inputConfig.addEventListener("keypress", (ev) => {
            if (ev.key === "Enter") {
                (
                    document.getElementById(
                        "load-config-load-button",
                    ) as HTMLButtonElement
                ).click();
            }
        });

        const hintConfig = createHint(
            "config-hint",
            `Enter the name of the config file placed in \`\\public\\configs\`. To get a config file,
            add one or more charts, click on the green Done button, and download the config file
            from Settings at the bottom of the page.`,
        );

        createDialog(
            "load-config-dialog",
            "Load charts from a config file",
            false,
            true,
            true,
            [labelConfig, inputConfig, hintConfig],
            [
                {
                    id: null,
                    text: "Close",
                    isGreen: false,
                    autoFocus: false,
                    onClick: (close) => close(),
                },
                {
                    id: "load-config-load-button",
                    text: "Load",
                    isGreen: true,
                    autoFocus: true,
                    onClick: async (close) => {
                        const loadButton = document.getElementById(
                            "load-config-load-button",
                        ) as HTMLButtonElement;
                        loadButton.disabled = true;

                        const fileName = inputConfig.value.trim();
                        let errorText = "";

                        if (!fileName) {
                            errorText = "Enter the name of the config file";
                        }

                        // test for \ / : * ? " < > | % &
                        if (new RegExp(/[\\/:%*?"<>|%&]/).test(fileName)) {
                            errorText =
                                "The file name must not contain reserved characters";
                        }

                        try {
                            const response = await fetch(
                                `/configs/${fileName}`,
                            );

                            if (!response.ok) {
                                if (response.status === 404) {
                                    errorText = `The file \`\\public\\configs\\${fileName}.json\` does not exist`;
                                } else {
                                    errorText =
                                        "Failed to load the config file";
                                    console.error(await response.text());
                                }
                            } else {
                                const groupConfigs =
                                    (await response.json()) as ChartGroupConfig[];

                                buttonDone.disabled = false;
                                divBigButtonGroup.remove();
                                buttonAddGroup.classList.remove("display-none");

                                for (const groupConfig of groupConfigs) {
                                    buttonAddGroup.before(
                                        createGroupConfigContainer(groupConfig),
                                    );
                                }

                                close();
                            }
                        } catch (e) {
                            errorText = "Failed to load the config file";
                            console.error(e);
                        }

                        if (errorText) {
                            loadButton.disabled = false;

                            inputConfig.classList.add("error");

                            hintConfig.classList.add("error");
                            hintConfig.textContent = errorText;

                            return;
                        }
                    },
                },
            ],
        );
    });

    const imgLoad = document.createElement("img");
    imgLoad.src = imgUploadUrl;
    imgLoad.ariaHidden = "true";

    const textLoad = document.createElement("span");
    textLoad.textContent = "Load charts";

    buttonLoad.appendChild(imgLoad);
    buttonLoad.appendChild(textLoad);

    divBigButtonGroup.appendChild(buttonAddChart);
    divBigButtonGroup.appendChild(buttonLoad);

    const buttonAddGroup = document.createElement("button");
    buttonAddGroup.id = "add-group-button";
    buttonAddGroup.classList.add("icon-text-button", "display-none");
    buttonAddGroup.addEventListener("click", (ev) => {
        ev.stopPropagation();

        const groupConfigContainer = createGroupConfigContainer(null);

        buttonAddGroup.before(groupConfigContainer);

        groupConfigContainer.scrollIntoView();
    });

    const textNewGroup = document.createElement("p");
    textNewGroup.textContent = "New group";

    buttonAddGroup.appendChild(imgAddChart.cloneNode());
    buttonAddGroup.appendChild(textNewGroup);

    container.append(topBar);
    container.appendChild(divBigButtonGroup);
    container.appendChild(buttonAddGroup);

    document.body.appendChild(container);

    // help dialog

    const textHelp = document.createElement("p");
    textHelp.id = "help-text";
    textHelp.textContent = `Every group has a fixed number of charts per row. This can be changed
        using the Configure Grid button. To get a different number of charts per row without
        affecting the existing rows, create a new group. For example, 2 groups are used to achieve
        the following layout:`;

    const gridHelp1 = document.createElement("div");
    gridHelp1.classList.add("help-grid");

    const gridHelp2 = document.createElement("div");
    gridHelp2.classList.add("help-grid");

    const gridHelp3 = document.createElement("div");
    gridHelp3.classList.add("help-grid", "help-grid-last");

    const div1 = document.createElement("div");
    div1.textContent = "1";

    const div2 = document.createElement("div");
    div2.textContent = "1";

    const div3 = document.createElement("div");
    div3.textContent = "1";

    const div4 = document.createElement("div");
    div4.textContent = "1";

    const div5 = document.createElement("div");
    div5.classList.add("help-grid-item-bottom");
    div5.textContent = "2";

    const div6 = document.createElement("div");
    div6.classList.add("help-grid-item-bottom");
    div6.textContent = "2";

    const div7 = document.createElement("div");
    div7.classList.add("help-grid-item-bottom");
    div7.textContent = "2";

    gridHelp1.appendChild(div1);
    gridHelp1.appendChild(div2);
    gridHelp2.appendChild(div3);
    gridHelp2.appendChild(div4);
    gridHelp3.appendChild(div5);
    gridHelp3.appendChild(div6);
    gridHelp3.appendChild(div7);

    createDialog(
        "help-dialog",
        "Help",
        false,
        false,
        false,
        [textHelp, gridHelp1, gridHelp2, gridHelp3],
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

    // configure grid dialog

    // small screen card in configure grid dialog

    const cardSmallScreen = document.createElement("div");
    cardSmallScreen.classList.add("card");

    const titleSmallScreen = document.createElement("h3");
    titleSmallScreen.classList.add("screen-size-title");
    titleSmallScreen.textContent = "Small screen (minimum width of 768 pixels)";

    const labelSmallColumns = createLabel(
        "Number of columns",
        "grid-small-columns-input",
        false,
    );

    const inputSmallColumns = createNumberInput(
        "grid-small-columns-input",
        "",
        "grid-small-columns-hint",
    );

    const hintSmallColumns = createHint(
        "grid-small-columns-hint",
        "Must be bigger than 0",
    );
    hintSmallColumns.classList.add("error", "display-none");

    const labelSmallWidth = createLabel(
        "Width (pixels)",
        "grid-small-width-input",
        false,
    );

    const inputSmallWidth = createNumberInput(
        "grid-small-width-input",
        "full",
        "grid-small-width-hint",
    );

    const hintSmallWidth = createHint(
        "grid-small-width-hint",
        "Must be between 300 and 768 inclusive. Leave the field blank for full width.",
    );

    cardSmallScreen.appendChild(titleSmallScreen);
    cardSmallScreen.appendChild(labelSmallColumns);
    cardSmallScreen.appendChild(inputSmallColumns);
    cardSmallScreen.appendChild(hintSmallColumns);
    cardSmallScreen.appendChild(labelSmallWidth);
    cardSmallScreen.appendChild(inputSmallWidth);
    cardSmallScreen.appendChild(hintSmallWidth);

    // medium screen card in configure grid dialog

    const cardMediumScreen = document.createElement("div");
    cardMediumScreen.classList.add("card");

    const titleMediumScreen = document.createElement("h3");
    titleMediumScreen.classList.add("screen-size-title");
    titleMediumScreen.textContent =
        "Medium screen (minimum width of 992 pixels)";

    const labelMediumColumns = createLabel(
        "Number of columns",
        "grid-medium-columns-input",
        false,
    );

    const inputMediumColumns = createNumberInput(
        "grid-medium-columns-input",
        "",
        "grid-medium-columns-hint",
    );

    const hintMediumColumns = createHint(
        "grid-medium-columns-hint",
        "Must be bigger than 0",
    );
    hintMediumColumns.classList.add("error", "display-none");

    const labelMediumWidth = createLabel(
        "Width (pixels)",
        "grid-medium-width-input",
        false,
    );

    const inputMediumWidth = createNumberInput(
        "grid-medium-width-input",
        "full",
        "grid-medium-width-hint",
    );

    const hintMediumWidth = createHint(
        "grid-medium-width-hint",
        "Must be between 300 and 992 inclusive. Leave the field blank for full width.",
    );

    cardMediumScreen.appendChild(titleMediumScreen);
    cardMediumScreen.appendChild(labelMediumColumns);
    cardMediumScreen.appendChild(inputMediumColumns);
    cardMediumScreen.appendChild(hintMediumColumns);
    cardMediumScreen.appendChild(labelMediumWidth);
    cardMediumScreen.appendChild(inputMediumWidth);
    cardMediumScreen.appendChild(hintMediumWidth);

    // large screen card in configure grid dialog

    const cardLargeScreen = document.createElement("div");
    cardLargeScreen.classList.add("card");

    const titleLargeScreen = document.createElement("h3");
    titleLargeScreen.classList.add("screen-size-title");
    titleLargeScreen.textContent =
        "Large screen (minimum width of 1400 pixels)";

    const labelLargeColumns = createLabel(
        "Number of columns",
        "grid-large-columns-input",
        false,
    );

    const inputLargeColumns = createNumberInput(
        "grid-large-columns-input",
        "",
        "grid-large-columns-hint",
    );

    const hintLargeColumns = createHint(
        "grid-large-columns-hint",
        "Must be bigger than 0",
    );
    hintLargeColumns.classList.add("error", "display-none");

    const labelLargeWidth = createLabel(
        "Width (pixels)",
        "grid-large-width-input",
        false,
    );

    const inputLargeWidth = createNumberInput(
        "grid-large-width-input",
        "full",
        "grid-large-width-hint",
    );

    const hintLargeWidth = createHint(
        "grid-large-width-hint",
        "Must be between 300 and 1400 inclusive. Leave the field blank for full width.",
    );

    cardLargeScreen.appendChild(titleLargeScreen);
    cardLargeScreen.appendChild(labelLargeColumns);
    cardLargeScreen.appendChild(inputLargeColumns);
    cardLargeScreen.appendChild(hintLargeColumns);
    cardLargeScreen.appendChild(labelLargeWidth);
    cardLargeScreen.appendChild(inputLargeWidth);
    cardLargeScreen.appendChild(hintLargeWidth);

    // extra large screen card in configure grid dialog

    const cardExtraLargeScreen = document.createElement("div");
    cardExtraLargeScreen.classList.add("card");

    const titleExtraLargeScreen = document.createElement("h3");
    titleExtraLargeScreen.classList.add("screen-size-title");
    titleExtraLargeScreen.textContent =
        "Extra large screen (minimum width of 1880 pixels)";

    const labelExtraLargeColumns = createLabel(
        "Number of columns",
        "grid-extra-large-columns-input",
        false,
    );

    const inputExtraLargeColumns = createNumberInput(
        "grid-extra-large-columns-input",
        "",
        "grid-extra-large-columns-hint",
    );

    const hintExtraLargeColumns = createHint(
        "grid-extra-large-columns-hint",
        "Must be bigger than 0",
    );
    hintExtraLargeColumns.classList.add("error", "display-none");

    const labelExtraLargeWidth = createLabel(
        "Width (pixels)",
        "grid-extra-large-width-input",
        false,
    );

    const inputExtraLargeWidth = createNumberInput(
        "grid-extra-large-width-input",
        "full",
        "grid-extra-large-width-hint",
    );

    const hintExtraLargeWidth = createHint(
        "grid-extra-large-width-hint",
        "Must be between 300 and 1880 inclusive. Leave the field blank for full width.",
    );

    cardExtraLargeScreen.appendChild(titleExtraLargeScreen);
    cardExtraLargeScreen.appendChild(labelExtraLargeColumns);
    cardExtraLargeScreen.appendChild(inputExtraLargeColumns);
    cardExtraLargeScreen.appendChild(hintExtraLargeColumns);
    cardExtraLargeScreen.appendChild(labelExtraLargeWidth);
    cardExtraLargeScreen.appendChild(inputExtraLargeWidth);
    cardExtraLargeScreen.appendChild(hintExtraLargeWidth);

    createDialog(
        "configure-grid-dialog",
        "Configure grid",
        false,
        false,
        false,
        [
            createDialogText(
                `Set number of columns, and width on different screen sizes. The number of column
                on a screen should be smaller or equal to the number of columns on bigger screens.`,
            ),
            cardSmallScreen,
            cardMediumScreen,
            cardLargeScreen,
            cardExtraLargeScreen,
        ],
        [
            {
                id: null,
                text: "Cancel",
                isGreen: false,
                autoFocus: true,
                onClick: (close) => {
                    inputSmallColumns.classList.remove("error");
                    hintSmallColumns.classList.add("display-none");

                    inputSmallWidth.classList.remove("error");
                    hintSmallWidth.classList.remove("error");

                    inputMediumColumns.classList.remove("error");
                    hintMediumColumns.classList.add("display-none");

                    inputMediumWidth.classList.remove("error");
                    hintMediumWidth.classList.remove("error");

                    inputLargeColumns.classList.remove("error");
                    hintLargeColumns.classList.add("display-none");

                    inputLargeWidth.classList.remove("error");
                    hintLargeWidth.classList.remove("error");

                    inputExtraLargeColumns.classList.remove("error");
                    hintExtraLargeColumns.classList.add("display-none");

                    inputExtraLargeWidth.classList.remove("error");
                    hintExtraLargeWidth.classList.remove("error");

                    close();
                },
            },
            {
                id: null,
                text: "Save",
                isGreen: true,
                autoFocus: false,
                onClick: (close) => {
                    let hasError = false;

                    const smallColumns = Number(inputSmallColumns.value.trim());
                    const smallWidthString = inputSmallWidth.value.trim();
                    const smallWidth = Number(smallWidthString);

                    const mediumColumns = Number(
                        inputMediumColumns.value.trim(),
                    );
                    const mediumWidthString = inputMediumWidth.value.trim();
                    const mediumWidth = Number(mediumWidthString);

                    const largeColumns = Number(inputLargeColumns.value.trim());
                    const largeWidthString = inputLargeWidth.value.trim();
                    const largeWidth = Number(largeWidthString);

                    const extraLargeColumns = Number(
                        inputExtraLargeColumns.value.trim(),
                    );
                    const extraLargeWidthString =
                        inputExtraLargeWidth.value.trim();
                    const extraLargeWidth = Number(extraLargeWidthString);

                    // all inputs must be an integer if not empty, column inputs must be bigger than 0,
                    // width inputs can be empty or within a range of numbers

                    if (
                        Number.isNaN(smallColumns) ||
                        !Number.isInteger(smallColumns) ||
                        smallColumns < 1
                    ) {
                        inputSmallColumns.classList.add("error");
                        hintSmallColumns.classList.remove("display-none");

                        hasError = true;
                    } else {
                        inputSmallColumns.classList.remove("error");
                        hintSmallColumns.classList.add("display-none");
                    }

                    if (
                        Number.isNaN(smallWidth) ||
                        !Number.isInteger(smallWidth) ||
                        (smallWidthString &&
                            (smallWidth < 300 || smallWidth > 768))
                    ) {
                        inputSmallWidth.classList.add("error");
                        hintSmallWidth.classList.add("error");

                        hasError = true;
                    } else {
                        inputSmallWidth.classList.remove("error");
                        hintSmallWidth.classList.remove("error");
                    }

                    if (
                        Number.isNaN(mediumColumns) ||
                        !Number.isInteger(mediumColumns) ||
                        mediumColumns < 1
                    ) {
                        inputMediumColumns.classList.add("error");
                        hintMediumColumns.classList.remove("display-none");

                        hasError = true;
                    } else {
                        inputMediumColumns.classList.remove("error");
                        hintMediumColumns.classList.add("display-none");
                    }

                    if (
                        Number.isNaN(mediumWidth) ||
                        !Number.isInteger(mediumWidth) ||
                        (mediumWidthString &&
                            (mediumWidth < 300 || mediumWidth > 992))
                    ) {
                        inputMediumWidth.classList.add("error");
                        hintMediumWidth.classList.add("error");

                        hasError = true;
                    } else {
                        inputMediumWidth.classList.remove("error");
                        hintMediumWidth.classList.remove("error");
                    }

                    if (
                        Number.isNaN(largeColumns) ||
                        !Number.isInteger(largeColumns) ||
                        largeColumns < 1
                    ) {
                        inputLargeColumns.classList.add("error");
                        hintLargeColumns.classList.remove("display-none");

                        hasError = true;
                    } else {
                        inputLargeColumns.classList.remove("error");
                        hintLargeColumns.classList.add("display-none");
                    }

                    if (
                        Number.isNaN(largeWidth) ||
                        !Number.isInteger(largeWidth) ||
                        (largeWidthString &&
                            (largeWidth < 300 || largeWidth > 1400))
                    ) {
                        inputLargeWidth.classList.add("error");
                        hintLargeWidth.classList.add("error");

                        hasError = true;
                    } else {
                        inputLargeWidth.classList.remove("error");
                        hintLargeWidth.classList.remove("error");
                    }

                    if (
                        Number.isNaN(extraLargeColumns) ||
                        !Number.isInteger(extraLargeColumns) ||
                        extraLargeColumns < 1
                    ) {
                        inputExtraLargeColumns.classList.add("error");
                        hintExtraLargeColumns.classList.remove("display-none");

                        hasError = true;
                    } else {
                        inputExtraLargeColumns.classList.remove("error");
                        hintExtraLargeColumns.classList.add("display-none");
                    }

                    if (
                        Number.isNaN(extraLargeWidth) ||
                        !Number.isInteger(extraLargeWidth) ||
                        (extraLargeWidthString &&
                            (extraLargeWidth < 300 || extraLargeWidth > 1880))
                    ) {
                        inputExtraLargeWidth.classList.add("error");
                        hintExtraLargeWidth.classList.add("error");

                        hasError = true;
                    } else {
                        inputExtraLargeWidth.classList.remove("error");
                        hintExtraLargeWidth.classList.remove("error");
                    }

                    if (!hasError) {
                        const groupConfig =
                            chartGroupConfigs[currentGroupConfigIndex];

                        groupConfig.gridBreakpoints.smallColumns = smallColumns;
                        groupConfig.gridBreakpoints.smallWidth = smallWidth;

                        groupConfig.gridBreakpoints.mediumColumns =
                            mediumColumns;
                        groupConfig.gridBreakpoints.mediumWidth = mediumWidth;

                        groupConfig.gridBreakpoints.largeColumns = largeColumns;
                        groupConfig.gridBreakpoints.largeWidth = largeWidth;

                        groupConfig.gridBreakpoints.extraLargeColumns =
                            extraLargeColumns;
                        groupConfig.gridBreakpoints.extraLargeWidth =
                            extraLargeWidth;

                        configureGrid(
                            groupConfig.gridContainer,
                            groupConfig.gridBreakpoints,
                            getScreenWidth(),
                        );

                        close();
                    } else {
                        // scroll to the first input with the `error` class
                        document
                            .querySelector(
                                "#configure-grid-dialog > div.dialog-body > .card > input.error",
                            )!
                            .scrollIntoView();
                    }
                },
            },
        ],
    );

    // configure chart dialog

    const labelTitle = createLabel("Title", "chart-title-input", true);

    const inputTitle = document.createElement("input");
    inputTitle.id = "chart-title-input";
    inputTitle.type = "text";

    const labelType = createLabel("Type", "chart-type-select", false);

    const selectType = document.createElement("select");
    selectType.id = "chart-type-select";
    selectType.addEventListener("change", (ev) => {
        ev.stopPropagation();

        const fromType = currentConfig.chartType;
        currentConfig.chartType =
            selectType.value as typeof currentConfig.chartType;

        if (fromType === "table") {
            // other charts cannot have readings with different units

            let deleteTables = false;
            const firstUnit =
                currentConfig.datasets.length > 1
                    ? currentConfig.datasets[0].unit
                    : "";

            for (let i = 1; i < currentConfig.datasets.length; i++) {
                if (currentConfig.datasets[i].unit !== firstUnit) {
                    deleteTables = true;

                    break;
                }
            }

            if (deleteTables) {
                currentConfig.datasets = [];
                addedSensorButtonGroups = [];

                listSensors.replaceChildren(listSensors.lastChild!);
            }
        }

        updateConfigureChartDialog(
            currentConfig.chartType,
            labelDataCount,
            inputDataCount,
            hintDataCount,
            labelMaximumValue,
            inputMaximumValue,
            hintMaximumValue,
            labelAnimation,
            inputAnimation,
            hintAnimation,
            inputShowLegend,
            labelShowLegend,
            inputShowLabels,
            labelShowLabels,
            inputAutoColors,
            labelAutoColors,
            hintSensor,
        );

        resetAddSensorListItem();

        // set default values
        if (currentConfig.chartType === "bar") {
            inputShowLegend.checked = false;
            inputShowLabels.checked = true;

            currentConfig.autoColors = false;
            inputAutoColors.checked = false;
        } else if (currentConfig.chartType === "line") {
            inputDataCount.value = "5";
            inputShowLegend.checked = true;

            currentConfig.autoColors = true;
            inputAutoColors.checked = true;
        } else if (currentConfig.chartType === "gauge") {
            inputMaximumValue.value = "";
            inputShowLegend.checked = false;
            inputShowLabels.checked = false;

            currentConfig.autoColors = false;
            inputAutoColors.checked = false;

            currentConfig.datasets = [];
            addedSensorButtonGroups = [];

            listSensors.replaceChildren(listSensors.lastChild!);
        } else {
            inputShowLegend.checked = false;
            inputShowLabels.checked = false;

            currentConfig.autoColors = false;
            inputAutoColors.checked = false;
        }

        for (let i = 0; i < currentConfig.datasets.length; i++) {
            const dataset = currentConfig.datasets[i];
            const inputColor = addedSensorButtonGroups[i].color;

            let color: string;

            if (currentConfig.autoColors) {
                color = getColor(i);
            } else {
                color = colors[0];
            }

            dataset.color = color;
            inputColor.value = color;

            if (currentConfig.chartType === "table") {
                addedSensorButtonGroups[i].color.classList.add("display-none");
            } else {
                addedSensorButtonGroups[i].color.classList.remove(
                    "display-none",
                );
            }
        }
    });

    selectType.appendChild(
        createSelectOption("Bar", "bar", true, false, false),
    );
    selectType.appendChild(
        createSelectOption("Line", "line", false, false, false),
    );
    selectType.appendChild(
        createSelectOption("Gauge", "gauge", false, false, false),
    );
    selectType.appendChild(
        createSelectOption("Table", "table", false, false, false),
    );

    // only shown for line charts
    const labelDataCount = createLabel(
        "Number of data points",
        "chart-data-count-input",
        false,
    );
    labelDataCount.id = "chart-data-count-label";

    const inputDataCount = createNumberInput(
        "chart-data-count-input",
        "",
        "chart-data-count-hint",
    );

    const hintDataCount = createHint(
        "chart-data-count-hint",
        "Minimum number of data points must be 5. Chart rendering performance may degrade if the number is set too high.",
    );

    // only shown for gauge charts
    const labelMaximumValue = createLabel(
        "Maximum value",
        "chart-maximum-value-input",
        false,
    );
    labelMaximumValue.id = "chart-maximum-value-label";

    const inputMaximumValue = createNumberInput(
        "chart-maximum-value-input",
        "",
        "chart-maximum-value-hint",
    );

    const hintMaximumValue = createHint(
        "chart-maximum-value-hint",
        "The maximum value of the added sensor. The gauge chart may not work correctly if the maximum value is wrong.",
    );

    const labelHeight = createLabel(
        "Height (pixels)",
        "chart-height-input",
        false,
    );

    const inputHeight = createNumberInput(
        "chart-height-input",
        "",
        "chart-height-hint",
    );

    const hintHeight = createHint(
        "chart-height-hint",
        "Minimum height must be 300",
    );

    // not shown for tables
    const labelAnimation = createLabel(
        "Animation duration (milliseconds)",
        "chart-animation-input",
        false,
    );
    labelAnimation.id = "chart-animation-label";

    const inputAnimation = createNumberInput(
        "chart-animation-input",
        "",
        "chart-animation-hint",
    );

    const hintAnimation = createHint(
        "chart-animation-hint",
        "Between 0 and 1000 inclusive. Set to 0 to disable animation. Lower the value to improve chart rendering performance.",
    );

    // only shown for bar and line charts
    const divShowLegend = document.createElement("div");

    const inputShowLegend = document.createElement("input");
    inputShowLegend.id = "chart-show-legend-input";
    inputShowLegend.type = "checkbox";

    const labelShowLegend = createLabel(
        "Show legend",
        "chart-show-legend-input",
        false,
    );
    labelShowLegend.id = "chart-show-legend-label";
    labelShowLegend.classList.add("label-checkbox");

    divShowLegend.appendChild(inputShowLegend);
    divShowLegend.appendChild(labelShowLegend);

    // only shown for bar charts
    const divShowLabels = document.createElement("div");

    const inputShowLabels = document.createElement("input");
    inputShowLabels.id = "chart-show-labels-input";
    inputShowLabels.type = "checkbox";

    const labelShowLabels = createLabel(
        "Show x-axis labels",
        "chart-show-labels-input",
        false,
    );
    labelShowLabels.id = "chart-show-labels-label";
    labelShowLabels.classList.add("label-checkbox", "label-checkbox-margin");

    divShowLabels.appendChild(inputShowLabels);
    divShowLabels.appendChild(labelShowLabels);

    // only shown for bar and line charts
    const divAutoColors = document.createElement("div");

    const inputAutoColors = document.createElement("input");
    inputAutoColors.id = "chart-auto-color-input";
    inputAutoColors.type = "checkbox";
    inputAutoColors.addEventListener("change", (ev) => {
        ev.stopPropagation();

        const checked = inputAutoColors.checked;
        currentConfig.autoColors = checked;

        for (let i = 0; i < currentConfig.datasets.length; i++) {
            const dataset = currentConfig.datasets[i];
            const inputColor = addedSensorButtonGroups[i].color;

            if (checked) {
                const color = getColor(i);

                dataset.color = color;
                inputColor.value = color;
            } // do not change the colors when unchecked

            inputColor.disabled = checked;
        }
    });

    const labelAutoColors = createLabel(
        "Set colors automatically",
        "chart-auto-color-input",
        false,
    );
    labelAutoColors.id = "chart-auto-color-label";
    labelAutoColors.classList.add("label-checkbox", "label-checkbox-margin");

    divAutoColors.appendChild(inputAutoColors);
    divAutoColors.appendChild(labelAutoColors);

    // add sensor card for configure chart dialog

    // in HWiNFO, there are sensors, and every sensor has readings
    // sensors are called "sensor groups", and readings are called "sensors" in the UI to avoid confusion

    const labelSensors = document.createElement("p");
    labelSensors.id = "sensors-label";
    labelSensors.textContent = "Sensor (0)";

    const listSensors = document.createElement("ol");
    listSensors.id = "sensors-list";
    listSensors.setAttribute("aria-describedby", "sensors-label");

    const liAddSensor = document.createElement("li");

    const titleAddSensor = document.createElement("h3");
    titleAddSensor.classList.add("card-title");
    titleAddSensor.textContent = "New sensor";

    const labelSensorGroup = createLabel(
        "Sensor group",
        "dataset-sensor-group-select",
        true,
    );

    const selectSensorGroup = document.createElement("select");
    selectSensorGroup.id = "dataset-sensor-group-select";
    selectSensorGroup.addEventListener("change", (ev) => {
        ev.stopPropagation();

        const e = ev.currentTarget as HTMLSelectElement;
        const sensor = sensors.sensors[Number(e.value)];
        let hasAdded = false;

        selectSensor.replaceChildren();

        outer: for (let i = 0; i < sensor.readings.length; i++) {
            const reading = sensor.readings[i];
            const unit = reading.unit;

            // check if this reading was added
            for (const dataset of currentConfig.datasets) {
                if (
                    dataset.sensorId === sensor.id &&
                    dataset.sensorInstance === sensor.instance &&
                    dataset.readingId === reading.id
                ) {
                    continue outer;
                }
            }

            let add = true;
            if (
                currentConfig.chartType !== "table" &&
                currentConfig.datasets.length > 0
            ) {
                add = currentConfig.datasets[0].unit === unit;
            }

            if (add) {
                selectSensor.appendChild(
                    createSelectOption(
                        `${reading.name} [${unit}]`,
                        i.toString(),
                        false,
                        false,
                        false,
                    ),
                );

                if (!hasAdded) {
                    hasAdded = true;

                    selectSensor.disabled = false;

                    inputLabel.placeholder = reading.name;
                    inputLabel.value = "";
                    inputLabel.disabled = false;

                    hintSensor.textContent = hintSensorText;

                    buttonAddSensor.disabled = false;
                }
            }
        }

        if (!hasAdded) {
            selectSensor.disabled = true;

            inputLabel.placeholder = "";
            inputLabel.value = "";
            inputLabel.disabled = true;

            hintSensor.textContent = `No sensor with the unit [${currentConfig.datasets[0].unit}] is available`;

            buttonAddSensor.disabled = true;
        }
    });

    selectSensorGroup.appendChild(
        createSelectOption("Select a group", "none", true, true, true),
    );

    for (let i = 0; i < sensors.sensors.length; i++) {
        selectSensorGroup.appendChild(
            createSelectOption(
                sensors.sensors[i].name,
                i.toString(),
                false,
                false,
                false,
            ),
        );
    }

    const labelSensor = createLabel("Sensor", "dataset-sensor-select", false);

    const selectSensor = document.createElement("select");
    selectSensor.id = "dataset-sensor-select";
    selectSensor.disabled = true;
    selectSensor.setAttribute("aria-describedby", "dataset-sensor-hint");
    selectSensor.addEventListener("change", (ev) => {
        ev.stopPropagation();

        inputLabel.placeholder =
            sensors.sensors[Number(selectSensorGroup.value)].readings[
                Number(selectSensor.value)
            ].name;
        inputLabel.value = "";
    });

    const hintSensor = createHint("dataset-sensor-hint", hintSensorText);

    const labelLabel = createLabel("Label", "dataset-label-input", false);

    const inputLabel = document.createElement("input");
    inputLabel.id = "dataset-label-input";
    inputLabel.type = "text";
    inputLabel.disabled = true;

    const buttonAddSensor = document.createElement("button");
    buttonAddSensor.id = "dataset-add-button";
    buttonAddSensor.textContent = "Add";
    buttonAddSensor.disabled = true;
    buttonAddSensor.addEventListener("click", (ev) => {
        ev.stopPropagation();

        const sensor = sensors.sensors[Number(selectSensorGroup.value)];
        const readingIndex = Number(selectSensor.value);
        const reading = sensor.readings[readingIndex];
        const label = inputLabel.value.trim();

        let color: string;
        if (currentConfig.autoColors) {
            color = getColor(currentConfig.datasets.length);
        } else {
            color = colors[0];
        }

        currentConfig.datasets.push({
            sensorId: sensor.id,
            sensorInstance: sensor.instance,
            readingId: reading.id,
            label: label ? label : reading.name,
            unit: reading.unit,
            color,
        });

        addSensorListItem(
            listSensors,
            sensor.name,
            reading.name,
            label,
            color,
            true,
        );

        updateAddedSensorButtonGroups();
        updateListSensorsLabel();
        resetAddSensorListItem();
    });

    liAddSensor.appendChild(titleAddSensor);
    liAddSensor.appendChild(labelSensorGroup);
    liAddSensor.appendChild(selectSensorGroup);
    liAddSensor.appendChild(labelSensor);
    liAddSensor.appendChild(selectSensor);
    liAddSensor.appendChild(hintSensor);
    liAddSensor.appendChild(labelLabel);
    liAddSensor.appendChild(inputLabel);
    liAddSensor.appendChild(buttonAddSensor);

    listSensors.appendChild(liAddSensor);

    const note = document.createElement("small");
    note.textContent = "The data in the preview charts is randomly generated";

    createDialog(
        "configure-chart-dialog",
        "",
        true,
        false,
        false,
        [
            labelTitle,
            inputTitle,
            labelType,
            selectType,
            labelDataCount,
            inputDataCount,
            hintDataCount,
            labelMaximumValue,
            inputMaximumValue,
            hintMaximumValue,
            labelHeight,
            inputHeight,
            hintHeight,
            labelAnimation,
            inputAnimation,
            hintAnimation,
            divShowLegend,
            divShowLabels,
            divAutoColors,
            labelSensors,
            listSensors,
            note,
        ],
        [
            {
                id: null,
                text: "Cancel",
                isGreen: false,
                autoFocus: true,
                onClick: (close) => {
                    addedSensorButtonGroups = [];

                    close();
                },
            },
            {
                id: "configure-chart-add-button",
                text: "",
                isGreen: true,
                autoFocus: false,
                onClick: (close) => {
                    let hasError = false;

                    const title = inputTitle.value.trim();
                    if (!title) {
                        inputTitle.classList.add("error");

                        hasError = true;
                    } else {
                        inputTitle.classList.remove("error");
                    }

                    // some inputs are only required for specific chart types
                    // a default value is used if an input is not required, to pass the validation

                    let dataCountNumber: number;
                    const dataCountString =
                        currentConfig.chartType === "line"
                            ? inputDataCount.value.trim()
                            : "5";

                    if (dataCountString) {
                        dataCountNumber = Number(dataCountString);

                        if (
                            Number.isNaN(dataCountNumber) ||
                            !Number.isInteger(dataCountNumber) ||
                            dataCountNumber < 5
                        ) {
                            inputDataCount.classList.add("error");
                            hintDataCount.classList.add("error");

                            hasError = true;
                        } else {
                            inputDataCount.classList.remove("error");
                            hintDataCount.classList.remove("error");
                        }
                    } else {
                        inputDataCount.classList.add("error");
                        hintDataCount.classList.add("error");

                        hasError = true;
                    }

                    let maximumValueNumber: number;
                    const maximumValueString =
                        currentConfig.chartType === "gauge"
                            ? inputMaximumValue.value.trim()
                            : "1";

                    if (maximumValueString) {
                        maximumValueNumber = Number(maximumValueString);

                        if (
                            Number.isNaN(maximumValueNumber) ||
                            maximumValueNumber <= 0
                        ) {
                            inputMaximumValue.classList.add("error");
                            hintMaximumValue.classList.add("error");

                            hasError = true;
                        } else {
                            inputMaximumValue.classList.remove("error");
                            hintMaximumValue.classList.remove("error");
                        }
                    } else {
                        inputMaximumValue.classList.add("error");
                        hintMaximumValue.classList.add("error");

                        hasError = true;
                    }

                    let heightNumber: number;
                    const heightString = inputHeight.value.trim();

                    if (heightString) {
                        heightNumber = Number(heightString);

                        if (
                            Number.isNaN(heightNumber) ||
                            !Number.isInteger(heightNumber) ||
                            heightNumber < 300
                        ) {
                            inputHeight.classList.add("error");
                            hintHeight.classList.add("error");

                            hasError = true;
                        } else {
                            inputHeight.classList.remove("error");
                            hintHeight.classList.remove("error");
                        }
                    } else {
                        inputHeight.classList.add("error");
                        hintHeight.classList.add("error");

                        hasError = true;
                    }

                    let animationNumber: number;
                    const animationString =
                        currentConfig.chartType === "table"
                            ? "0"
                            : inputAnimation.value.trim();

                    if (animationString) {
                        animationNumber = Number(animationString);

                        if (
                            Number.isNaN(animationNumber) ||
                            !Number.isInteger(animationNumber) ||
                            animationNumber < 0 ||
                            animationNumber > 1000
                        ) {
                            inputAnimation.classList.add("error");
                            hintAnimation.classList.add("error");

                            hasError = true;
                        } else {
                            inputAnimation.classList.remove("error");
                            hintAnimation.classList.remove("error");
                        }
                    } else {
                        inputAnimation.classList.add("error");
                        hintAnimation.classList.add("error");

                        hasError = true;
                    }

                    if (!hasError) {
                        currentConfig.title = title;
                        currentConfig.dataCount =
                            currentConfig.chartType === "line"
                                ? dataCountNumber!
                                : 0;
                        currentConfig.maximumValue =
                            currentConfig.chartType === "gauge"
                                ? maximumValueNumber!
                                : 0;
                        currentConfig.height = heightNumber!;
                        currentConfig.animationDuration = animationNumber!;
                        currentConfig.showLegend = inputShowLegend.checked;
                        currentConfig.showLabels = inputShowLabels.checked;
                        currentConfig.autoColors = inputAutoColors.checked;

                        const groupConfig =
                            chartGroupConfigs[currentGroupConfigIndex];
                        groupConfig.card.classList.remove("error");

                        if (currentConfigChartAction === "add") {
                            const chartContainer = createChartContainer(
                                currentConfig,
                                currentGroupConfigIndex,
                                true,
                                groupConfig.chartConfigs.length,
                            );

                            groupConfig.gridContainer.appendChild(
                                chartContainer,
                            );
                            groupConfig.chartContainers.push(chartContainer);

                            chartContainer.scrollIntoView({ block: "nearest" });
                        } else {
                            groupConfig.chartConfigs[
                                currentConfigIndex
                            ].chart?.destroy();

                            const chartContainer = createChartContainer(
                                currentConfig,
                                currentGroupConfigIndex,
                                true,
                                currentConfigIndex,
                            );

                            const oldContainer =
                                groupConfig.chartContainers[currentConfigIndex];
                            oldContainer.replaceWith(chartContainer);

                            groupConfig.chartContainers[currentConfigIndex] =
                                chartContainer;
                        }

                        addedSensorButtonGroups = [];

                        close();
                    } else {
                        // scroll to the first input with the `error` class
                        document
                            .querySelector(
                                "#configure-chart-dialog > div.dialog-body > input.error",
                            )!
                            .scrollIntoView();
                    }
                },
            },
        ],
    );

    if (groupConfigs.length > 0) {
        // skip the add load buttons selection
        buttonAddChart.click();
    }

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            // scroll to top after the container is rendered
            window.scrollTo({ top: 0 });
        });
    });
};

const createGroupConfigContainer = (
    groupConfig: ChartGroupConfig | null,
): HTMLDivElement => {
    const container = document.createElement("div");
    container.classList.add("cfg-chart-group-container", "fade-in");
    container.addEventListener(
        "animationend",
        (_) => {
            container.classList.remove("fade-in");
        },
        { once: true },
    );

    const cardContainer = document.createElement("div");
    cardContainer.classList.add("cfg-chart-card-container");

    const card = document.createElement("div");
    card.classList.add("card");

    const buttonHelp = document.createElement("button");
    buttonHelp.classList.add("icon-button", "help-button");
    buttonHelp.ariaLabel = "Help";
    buttonHelp.addEventListener("click", onClickHelp);

    const imgHelp = document.createElement("img");
    imgHelp.src = imgHelpUrl;
    imgHelp.ariaHidden = "true";

    buttonHelp.appendChild(imgHelp);

    const cardTitle = document.createElement("h3");
    cardTitle.classList.add("card-title");
    cardTitle.textContent = "Group";

    const buttonRow = document.createElement("div");
    buttonRow.classList.add("button-row");

    const buttonGrid = document.createElement("button");
    buttonGrid.classList.add("icon-text-button");
    buttonGrid.addEventListener("click", onClickConfigureGrid);

    const imgGrid = document.createElement("img");
    imgGrid.src = imgGridUrl;
    imgGrid.ariaHidden = "true";

    const textGrid = document.createElement("p");
    textGrid.textContent = "Configure grid";

    buttonGrid.appendChild(imgGrid);
    buttonGrid.appendChild(textGrid);

    const buttonAdd = document.createElement("button");
    buttonAdd.classList.add("icon-text-button");
    buttonAdd.dataset.action = "add";
    buttonAdd.addEventListener("click", onClickAddEditChart);

    const imgAdd = document.createElement("img");
    imgAdd.src = imgAddUrl;
    imgAdd.ariaHidden = "true";

    const textAdd = document.createElement("p");
    textAdd.textContent = "Add chart";

    buttonAdd.appendChild(imgAdd);
    buttonAdd.appendChild(textAdd);

    buttonRow.appendChild(buttonGrid);
    buttonRow.appendChild(buttonAdd);

    const buttonGroup = document.createElement("div");
    buttonGroup.classList.add("icon-button-group");

    const buttonUp = document.createElement("button");
    buttonUp.dataset.action = "up";
    buttonUp.ariaLabel = "Move up";
    buttonUp.addEventListener("click", onClickGroupButtonGroup);

    const imgUp = document.createElement("img");
    imgUp.src = imgUpUrl;
    imgUp.ariaHidden = "true";

    buttonUp.appendChild(imgUp);

    const buttonDown = document.createElement("button");
    buttonDown.dataset.action = "down";
    buttonDown.ariaLabel = "Move down";
    buttonDown.addEventListener("click", onClickGroupButtonGroup);

    const imgDown = document.createElement("img");
    imgDown.src = imgDownUrl;
    imgDown.ariaHidden = "true";

    buttonDown.appendChild(imgDown);

    const buttonDelete = document.createElement("button");
    buttonDelete.dataset.action = "delete";
    buttonDelete.ariaLabel = "Delete";
    buttonDelete.addEventListener("click", onClickGroupButtonGroup);

    const imgDelete = document.createElement("img");
    imgDelete.src = imgDeleteUrl;
    imgDelete.ariaHidden = "true";

    buttonDelete.appendChild(imgDelete);

    buttonGroup.appendChild(buttonUp);
    buttonGroup.appendChild(buttonDown);
    buttonGroup.appendChild(buttonDelete);

    card.appendChild(buttonHelp);
    card.appendChild(cardTitle);
    card.appendChild(buttonRow);
    card.append(buttonGroup);

    cardContainer.appendChild(card);

    const gridContainer = document.createElement("div");
    gridContainer.classList.add("chart-grid-container");

    container.appendChild(cardContainer);
    container.appendChild(gridContainer);

    const gridBreakpoints = groupConfig
        ? groupConfig.gridBreakpoints
        : {
              smallColumns: 1,
              smallWidth: 0,
              mediumColumns: 2,
              mediumWidth: 0,
              largeColumns: 2,
              largeWidth: 0,
              extraLargeColumns: 3,
              extraLargeWidth: 0,
          };

    chartGroupConfigs.push({
        container,
        card,
        gridContainer,
        chartContainers: [],
        buttonRow: {
            grid: buttonGrid,
            add: buttonAdd,
        },
        buttonGroup: {
            up: buttonUp,
            down: buttonDown,
            delete: buttonDelete,
        },
        gridBreakpoints,
        chartConfigs: [],
    });

    updateGroupButtonGroup();
    configureGrid(gridContainer, gridBreakpoints, getScreenWidth());

    if (groupConfig) {
        const groupConfigIndex = chartGroupConfigs.length - 1;
        const chartContainers =
            chartGroupConfigs[groupConfigIndex].chartContainers;

        for (let i = 0; i < groupConfig.chartConfigs.length; i++) {
            const chartContainer = createChartContainer(
                groupConfig.chartConfigs[i],
                groupConfigIndex,
                true,
                i,
            );

            gridContainer.appendChild(chartContainer);
            chartContainers.push(chartContainer);
        }
    }

    return container;
};

const onClickConfigureGrid = (ev: MouseEvent) => {
    ev.stopPropagation();

    currentGroupConfigIndex = Number(
        (ev.currentTarget as HTMLElement).dataset.groupIndex,
    );

    const groupConfig = chartGroupConfigs[currentGroupConfigIndex];

    (
        document.getElementById("grid-small-columns-input") as HTMLInputElement
    ).value = groupConfig.gridBreakpoints.smallColumns.toString();

    if (groupConfig.gridBreakpoints.smallWidth !== 0) {
        (
            document.getElementById(
                "grid-small-width-input",
            ) as HTMLInputElement
        ).value = groupConfig.gridBreakpoints.smallWidth.toString();
    }

    (
        document.getElementById("grid-medium-columns-input") as HTMLInputElement
    ).value = groupConfig.gridBreakpoints.mediumColumns.toString();

    if (groupConfig.gridBreakpoints.mediumWidth !== 0) {
        (
            document.getElementById(
                "grid-medium-width-input",
            ) as HTMLInputElement
        ).value = groupConfig.gridBreakpoints.mediumWidth.toString();
    }

    (
        document.getElementById("grid-large-columns-input") as HTMLInputElement
    ).value = groupConfig.gridBreakpoints.largeColumns.toString();

    if (groupConfig.gridBreakpoints.largeWidth !== 0) {
        (
            document.getElementById(
                "grid-large-width-input",
            ) as HTMLInputElement
        ).value = groupConfig.gridBreakpoints.largeWidth.toString();
    }

    (
        document.getElementById(
            "grid-extra-large-columns-input",
        ) as HTMLInputElement
    ).value = groupConfig.gridBreakpoints.extraLargeColumns.toString();

    if (groupConfig.gridBreakpoints.extraLargeWidth !== 0) {
        (
            document.getElementById(
                "grid-extra-large-width-input",
            ) as HTMLInputElement
        ).value = groupConfig.gridBreakpoints.extraLargeWidth.toString();
    }

    showDialog(
        document.getElementById("configure-grid-dialog") as HTMLDialogElement,
    );
};

const onClickAddEditChart = (ev: MouseEvent) => {
    ev.stopPropagation();

    const e = ev.currentTarget as HTMLElement;
    const action = e.dataset.action;
    currentGroupConfigIndex = Number(e.dataset.groupIndex);
    currentConfigIndex = Number(e.dataset.configIndex);

    // get references to elements in the configure chart dialog
    const dialogTitle = document.querySelector(
        "#configure-chart-dialog > h2.dialog-title",
    ) as HTMLHeadingElement;
    const dialogAddButton = document.getElementById(
        "configure-chart-add-button",
    ) as HTMLButtonElement;
    const inputTitle = document.getElementById(
        "chart-title-input",
    ) as HTMLInputElement;
    const selectType = document.getElementById(
        "chart-type-select",
    ) as HTMLSelectElement;

    const labelDataCount = document.getElementById(
        "chart-data-count-label",
    ) as HTMLLabelElement;
    const inputDataCount = document.getElementById(
        "chart-data-count-input",
    ) as HTMLInputElement;
    const hintDataCount = document.getElementById(
        "chart-data-count-hint",
    ) as HTMLElement;

    const labelMaximumValue = document.getElementById(
        "chart-maximum-value-label",
    ) as HTMLLabelElement;
    const inputMaximumValue = document.getElementById(
        "chart-maximum-value-input",
    ) as HTMLInputElement;
    const hintMaximumValue = document.getElementById(
        "chart-maximum-value-hint",
    ) as HTMLElement;

    const inputHeight = document.getElementById(
        "chart-height-input",
    ) as HTMLInputElement;
    const hintHeight = document.getElementById(
        "chart-height-hint",
    ) as HTMLElement;

    const labelAnimation = document.getElementById(
        "chart-animation-label",
    ) as HTMLLabelElement;
    const inputAnimation = document.getElementById(
        "chart-animation-input",
    ) as HTMLInputElement;
    const hintAnimation = document.getElementById(
        "chart-animation-hint",
    ) as HTMLElement;

    const inputShowLegend = document.getElementById(
        "chart-show-legend-input",
    ) as HTMLInputElement;
    const labelShowLegend = document.getElementById(
        "chart-show-legend-label",
    ) as HTMLLabelElement;

    const inputShowLabels = document.getElementById(
        "chart-show-labels-input",
    ) as HTMLInputElement;
    const labelShowLabels = document.getElementById(
        "chart-show-labels-label",
    ) as HTMLLabelElement;

    const inputAutoColors = document.getElementById(
        "chart-auto-color-input",
    ) as HTMLInputElement;
    const labelAutoColors = document.getElementById(
        "chart-auto-color-label",
    ) as HTMLLabelElement;

    const listSensors = document.getElementById(
        "sensors-list",
    ) as HTMLOListElement;
    const hintSensor = document.getElementById(
        "dataset-sensor-hint",
    ) as HTMLElement;

    // reset the dialog elements
    inputTitle.classList.remove("error");

    inputDataCount.classList.remove("error");
    hintDataCount.classList.remove("error");

    inputMaximumValue.classList.remove("error");
    hintMaximumValue.classList.remove("error");

    inputHeight.classList.remove("error");
    hintHeight.classList.remove("error");

    inputAnimation.classList.remove("error");
    hintAnimation.classList.remove("error");

    listSensors.replaceChildren(listSensors.lastChild!);

    if (action === "add") {
        dialogTitle.textContent = "New chart";

        dialogAddButton.textContent = "Add";
        dialogAddButton.disabled = true;

        currentConfig = {
            title: "",
            chartType: "bar",
            dataCount: 0,
            maximumValue: 0,
            height: 300,
            animationDuration: 200,
            showLegend: false,
            showLabels: true,
            autoColors: false,
            datasets: [],
        };

        currentConfigChartAction = "add";
    } else {
        dialogTitle.textContent = "Edit chart";

        dialogAddButton.textContent = "Save";
        dialogAddButton.disabled = false;

        const config =
            chartGroupConfigs[currentGroupConfigIndex].chartConfigs[
                currentConfigIndex
            ];

        currentConfig = {
            title: config.title,
            chartType: config.chartType,
            dataCount: config.dataCount,
            maximumValue: config.maximumValue,
            height: config.height,
            animationDuration: config.animationDuration,
            showLegend: config.showLegend,
            showLabels: config.showLabels,
            autoColors: config.autoColors,
            datasets: config.datasets,
        };

        for (let i = 0; i < currentConfig.datasets.length; i++) {
            const dataset = currentConfig.datasets[i];
            const sensor = currentSensors!.sensors.find(
                (v) =>
                    v.id === dataset.sensorId &&
                    v.instance === dataset.sensorInstance,
            );

            // added readings will always be found except when the config is loaded from a file

            if (!sensor) {
                currentConfig.datasets.splice(i, 1);
                i -= 1;

                continue;
            }

            const reading = sensor.readings.find(
                (v) => v.id === dataset.readingId,
            );

            if (!reading) {
                currentConfig.datasets.splice(i, 1);
                i -= 1;

                continue;
            }

            addSensorListItem(
                listSensors,
                sensor.name,
                reading.name,
                dataset.label,
                dataset.color,
                false,
            );
        }

        updateAddedSensorButtonGroups();

        currentConfigChartAction = "edit";
    }

    inputTitle.value = currentConfig.title;
    selectType.value = currentConfig.chartType;
    inputDataCount.value = currentConfig.dataCount.toString();
    inputMaximumValue.value = currentConfig.maximumValue.toString();
    inputHeight.value = currentConfig.height.toString();
    inputAnimation.value = currentConfig.animationDuration.toString();
    inputShowLegend.checked = currentConfig.showLegend;
    inputShowLabels.checked = currentConfig.showLabels;
    inputAutoColors.checked = currentConfig.autoColors;

    updateConfigureChartDialog(
        currentConfig.chartType,
        labelDataCount,
        inputDataCount,
        hintDataCount,
        labelMaximumValue,
        inputMaximumValue,
        hintMaximumValue,
        labelAnimation,
        inputAnimation,
        hintAnimation,
        inputShowLegend,
        labelShowLegend,
        inputShowLabels,
        labelShowLabels,
        inputAutoColors,
        labelAutoColors,
        hintSensor,
    );

    updateListSensorsLabel();
    resetAddSensorListItem();

    showDialog(
        document.getElementById("configure-chart-dialog") as HTMLDialogElement,
    );
};

const onClickHelp = (ev: MouseEvent) => {
    ev.stopPropagation();

    showDialog(document.getElementById("help-dialog") as HTMLDialogElement);
};

const onClickGroupButtonGroup = (ev: MouseEvent) => {
    ev.stopPropagation();

    const e = ev.currentTarget as HTMLElement;
    const action = e.dataset.action;
    const groupConfigIndex = Number(e.dataset.groupIndex);

    if (action === "up") {
        [
            chartGroupConfigs[groupConfigIndex - 1],
            chartGroupConfigs[groupConfigIndex],
        ] = [
            chartGroupConfigs[groupConfigIndex],
            chartGroupConfigs[groupConfigIndex - 1],
        ];

        const groupConfigContainer =
            chartGroupConfigs[groupConfigIndex - 1].container;
        groupConfigContainer.classList.add("container-move-up");
        groupConfigContainer.addEventListener(
            "animationend",
            (_) => {
                groupConfigContainer.classList.remove("container-move-up");
            },
            { once: true },
        );

        groupConfigContainer.after(
            chartGroupConfigs[groupConfigIndex].container,
        );
        groupConfigContainer.scrollIntoView();

        updateDropdownItems(groupConfigIndex - 1);
        updateDropdownItems(groupConfigIndex);

        updateGroupButtonGroup();
    } else if (action === "down") {
        [
            chartGroupConfigs[groupConfigIndex],
            chartGroupConfigs[groupConfigIndex + 1],
        ] = [
            chartGroupConfigs[groupConfigIndex + 1],
            chartGroupConfigs[groupConfigIndex],
        ];

        const groupConfigContainer =
            chartGroupConfigs[groupConfigIndex + 1].container;
        groupConfigContainer.classList.add("container-move-down");
        groupConfigContainer.addEventListener(
            "animationend",
            (_) => {
                groupConfigContainer.classList.remove("container-move-down");
            },
            { once: true },
        );

        groupConfigContainer.before(
            chartGroupConfigs[groupConfigIndex].container,
        );
        groupConfigContainer.scrollIntoView();

        updateDropdownItems(groupConfigIndex + 1);
        updateDropdownItems(groupConfigIndex);

        updateGroupButtonGroup();
    } else {
        // action === "delete"

        createDialog(
            "delete-dialog",
            "Delete this group?",
            false,
            true,
            true,
            [createDialogText("This action cannot be undone")],
            [
                {
                    id: null,
                    text: "No",
                    isGreen: false,
                    autoFocus: true,
                    onClick: (close) => close(),
                },
                {
                    id: null,
                    text: "Yes",
                    isGreen: false,
                    autoFocus: false,
                    onClick: (close) => {
                        chartGroupConfigs
                            .splice(groupConfigIndex, 1)[0]
                            .container.remove();

                        for (let i = 0; i < chartGroupConfigs.length; i++) {
                            updateDropdownItems(i);
                        }

                        updateGroupButtonGroup();

                        close();
                    },
                },
            ],
        );
    }
};

const updateGroupButtonGroup = () => {
    const groupConfigCount = chartGroupConfigs.length;

    for (let i = 0; i < groupConfigCount; i++) {
        const groupConfig = chartGroupConfigs[i];
        const groupIndexStr = i.toString();
        const buttonGroup = groupConfig.buttonGroup;

        groupConfig.buttonRow.grid.dataset.groupIndex = groupIndexStr;
        groupConfig.buttonRow.add.dataset.groupIndex = groupIndexStr;

        buttonGroup.up.disabled = i === 0;
        buttonGroup.up.dataset.groupIndex = groupIndexStr;

        buttonGroup.down.disabled = i === groupConfigCount - 1;
        buttonGroup.down.dataset.groupIndex = groupIndexStr;

        buttonGroup.delete.disabled = groupConfigCount === 1;
        buttonGroup.delete.dataset.groupIndex = groupIndexStr;
    }
};

const updateConfigureChartDialog = (
    chartType: ChartConfig["chartType"],
    labelDataCount: HTMLLabelElement,
    inputDataCount: HTMLInputElement,
    hintDataCount: HTMLElement,
    labelMaximumValue: HTMLLabelElement,
    inputMaximumValue: HTMLInputElement,
    hintMaximumValue: HTMLElement,
    labelAnimation: HTMLLabelElement,
    inputAnimation: HTMLInputElement,
    hintAnimation: HTMLElement,
    inputShowLegend: HTMLInputElement,
    labelShowLegend: HTMLLabelElement,
    inputShowLabels: HTMLInputElement,
    labelShowLabels: HTMLLabelElement,
    inputAutoColors: HTMLInputElement,
    labelAutoColors: HTMLLabelElement,
    hintSensor: HTMLElement,
) => {
    // hide or show elements depending on the chart type

    if (chartType === "bar" || chartType === "line") {
        if (currentConfig.chartType === "bar") {
            labelDataCount.classList.add("display-none");
            inputDataCount.classList.add("display-none");
            hintDataCount.classList.add("display-none");

            labelShowLabels.classList.remove("display-none");
            inputShowLabels.classList.remove("display-none");
        } else {
            labelDataCount.classList.remove("display-none");
            inputDataCount.classList.remove("display-none");
            hintDataCount.classList.remove("display-none");

            labelShowLabels.classList.add("display-none");
            inputShowLabels.classList.add("display-none");
        }

        labelMaximumValue.classList.add("display-none");
        inputMaximumValue.classList.add("display-none");
        hintMaximumValue.classList.add("display-none");

        labelAnimation.classList.remove("display-none");
        inputAnimation.classList.remove("display-none");
        hintAnimation.classList.remove("display-none");

        labelShowLegend.classList.remove("display-none");
        inputShowLegend.classList.remove("display-none");

        inputAutoColors.classList.remove("display-none");
        labelAutoColors.classList.remove("display-none");

        hintSensor.classList.remove("display-none");
    } else {
        if (chartType === "gauge") {
            labelMaximumValue.classList.remove("display-none");
            inputMaximumValue.classList.remove("display-none");
            hintMaximumValue.classList.remove("display-none");

            labelAnimation.classList.remove("display-none");
            inputAnimation.classList.remove("display-none");
            hintAnimation.classList.remove("display-none");
        } else {
            labelMaximumValue.classList.add("display-none");
            inputMaximumValue.classList.add("display-none");
            hintMaximumValue.classList.add("display-none");

            labelAnimation.classList.add("display-none");
            inputAnimation.classList.add("display-none");
            hintAnimation.classList.add("display-none");
        }

        labelDataCount.classList.add("display-none");
        inputDataCount.classList.add("display-none");
        hintDataCount.classList.add("display-none");

        labelShowLegend.classList.add("display-none");
        inputShowLegend.classList.add("display-none");

        labelShowLabels.classList.add("display-none");
        inputShowLabels.classList.add("display-none");

        inputAutoColors.classList.add("display-none");
        labelAutoColors.classList.add("display-none");

        hintSensor.classList.add("display-none");
    }
};

const addSensorListItem = (
    list: HTMLOListElement,
    sensorName: string,
    readingName: string,
    label: string,
    color: string,
    scrollIntoView: boolean,
) => {
    const li = document.createElement("li");

    const heading = document.createElement("h4");
    heading.classList.add("list-heading");
    heading.textContent = sensorName;

    const text = document.createElement("p");
    text.classList.add("list-text");
    text.textContent = `${readingName}`;

    if (label) {
        text.textContent = label;

        const span = document.createElement("span");
        span.classList.add("list-text-italic");
        span.title = "Sensor name";
        span.textContent = `(${readingName})`;

        text.appendChild(span);
    } else {
        text.textContent = `${readingName}`;
    }

    const buttonGroupIndex = addedSensorButtonGroups.length.toString();

    const buttonGroup = document.createElement("div");
    buttonGroup.classList.add("icon-button-group");

    const inputColor = document.createElement("input");
    inputColor.type = "color";
    inputColor.title = "Choose a color";
    inputColor.value = color;
    inputColor.disabled = currentConfig.autoColors;

    if (currentConfig.chartType === "table") {
        inputColor.classList.add("display-none");
    }

    const buttonUp = document.createElement("button");
    buttonUp.dataset.action = "up";
    buttonUp.dataset.index = buttonGroupIndex;
    buttonUp.ariaLabel = "Move up";
    buttonUp.addEventListener("click", onClickAddedSensorButtonGroup);

    const imgUp = document.createElement("img");
    imgUp.src = imgUpUrl;
    imgUp.ariaHidden = "true";

    buttonUp.appendChild(imgUp);

    const buttonDown = document.createElement("button");
    buttonDown.dataset.action = "down";
    buttonDown.dataset.index = buttonGroupIndex;
    buttonDown.ariaLabel = "Move down";
    buttonDown.addEventListener("click", onClickAddedSensorButtonGroup);

    const imgDown = document.createElement("img");
    imgDown.src = imgDownUrl;
    imgDown.ariaHidden = "true";

    buttonDown.appendChild(imgDown);

    const buttonDelete = document.createElement("button");
    buttonDelete.dataset.action = "delete";
    buttonDelete.dataset.index = buttonGroupIndex;
    buttonDelete.ariaLabel = "Delete";
    buttonDelete.addEventListener("click", onClickAddedSensorButtonGroup);

    const imgDelete = document.createElement("img");
    imgDelete.src = imgDeleteUrl;
    imgDelete.ariaHidden = "true";

    buttonDelete.appendChild(imgDelete);

    buttonGroup.appendChild(inputColor);
    buttonGroup.appendChild(buttonUp);
    buttonGroup.appendChild(buttonDown);
    buttonGroup.appendChild(buttonDelete);

    li.appendChild(heading);
    li.appendChild(text);
    li.appendChild(buttonGroup);

    // add before the last item as the last item is the new sensor form
    list.insertBefore(li, list.lastChild);

    addedSensorButtonGroups.push({
        color: inputColor,
        up: buttonUp,
        down: buttonDown,
        delete: buttonDelete,
    });

    if (scrollIntoView) {
        li.scrollIntoView();
    }
};

const onClickAddedSensorButtonGroup = (ev: MouseEvent) => {
    ev.stopPropagation();

    const e = ev.currentTarget as HTMLElement;
    const action = e.dataset.action;
    const index = Number(e.dataset.index);

    const listSensors = document.getElementById(
        "sensors-list",
    ) as HTMLOListElement;

    if (action === "up") {
        const datasets = currentConfig.datasets;

        if (currentConfig.autoColors) {
            const currentColor = datasets[index].color;
            const nextColor = datasets[index - 1].color;

            datasets[index].color = nextColor;
            datasets[index - 1].color = currentColor;

            addedSensorButtonGroups[index].color.value = nextColor;
            addedSensorButtonGroups[index - 1].color.value = currentColor;
        }

        [datasets[index - 1], datasets[index]] = [
            datasets[index],
            datasets[index - 1],
        ];
        [addedSensorButtonGroups[index - 1], addedSensorButtonGroups[index]] = [
            addedSensorButtonGroups[index],
            addedSensorButtonGroups[index - 1],
        ];

        const currentSensor = listSensors.children[index];
        currentSensor.classList.add("move-up");
        currentSensor.addEventListener(
            "animationend",
            (_) => {
                currentSensor.classList.remove("move-up");
            },
            { once: true },
        );

        currentSensor.after(listSensors.children[index - 1]);
        currentSensor.scrollIntoView({ block: "nearest" });
    } else if (action === "down") {
        const datasets = currentConfig.datasets;

        if (currentConfig.autoColors) {
            const currentColor = datasets[index].color;
            const nextColor = datasets[index + 1].color;

            datasets[index].color = nextColor;
            datasets[index + 1].color = currentColor;

            addedSensorButtonGroups[index].color.value = nextColor;
            addedSensorButtonGroups[index + 1].color.value = currentColor;
        }

        [datasets[index], datasets[index + 1]] = [
            datasets[index + 1],
            datasets[index],
        ];
        [addedSensorButtonGroups[index], addedSensorButtonGroups[index + 1]] = [
            addedSensorButtonGroups[index + 1],
            addedSensorButtonGroups[index],
        ];

        const currentSensor = listSensors.children[index];
        currentSensor.classList.add("move-down");
        currentSensor.addEventListener(
            "animationend",
            (_) => {
                currentSensor.classList.remove("move-down");
            },
            { once: true },
        );

        currentSensor.before(listSensors.children[index + 1]);
        currentSensor.scrollIntoView({ block: "nearest" });
    } else {
        // action === "delete"
        const datasets = currentConfig.datasets;

        listSensors.children[index].remove();

        addedSensorButtonGroups.splice(index, 1);
        datasets.splice(index, 1);

        if (currentConfig.autoColors) {
            for (let i = 0; i < datasets.length; i++) {
                const color = getColor(i);

                datasets[i].color = color;
                addedSensorButtonGroups[i].color.value = color;
            }
        }

        updateListSensorsLabel();
        resetAddSensorListItem();
    }

    updateAddedSensorButtonGroups();
};

const updateAddedSensorButtonGroups = () => {
    const count = addedSensorButtonGroups.length;

    for (let i = 0; i < count; i++) {
        const group = addedSensorButtonGroups[i];
        const indexStr = i.toString();

        group.up.disabled = i === 0;
        group.up.dataset.index = indexStr;

        group.down.disabled = i === count - 1;
        group.down.dataset.index = indexStr;

        group.delete.dataset.index = indexStr;
    }
};

const updateListSensorsLabel = () => {
    const count = currentConfig.datasets.length;

    document.getElementById("sensors-label")!.textContent =
        `Sensor${count > 1 ? "s" : ""} (${count})`;
};

const getColor = (index: number): string => colors[index % colors.length];

const resetAddSensorListItem = () => {
    const selectSensorGroup = document.getElementById(
        "dataset-sensor-group-select",
    ) as HTMLSelectElement;
    selectSensorGroup.selectedIndex = 0;
    // only one reading can be added to gauge charts
    selectSensorGroup.disabled =
        currentConfig.chartType === "gauge" &&
        currentConfig.datasets.length > 0;

    const selectSensor = document.getElementById(
        "dataset-sensor-select",
    ) as HTMLSelectElement;
    selectSensor.replaceChildren();
    selectSensor.disabled = true;

    const hintSensor = document.getElementById(
        "dataset-sensor-hint",
    ) as HTMLElement;
    hintSensor.textContent = hintSensorText;

    const inputLabel = document.getElementById(
        "dataset-label-input",
    ) as HTMLInputElement;

    inputLabel.placeholder = "";
    inputLabel.value = "";
    inputLabel.disabled = true;

    (
        document.getElementById("dataset-add-button") as HTMLButtonElement
    ).disabled = true;

    (
        document.getElementById(
            "configure-chart-add-button",
        ) as HTMLButtonElement
    ).disabled = currentConfig.datasets.length === 0;
};

const createChartContainer = (
    chartConfig: ChartConfig,
    groupIndex: number,
    isPreview: boolean,
    chartConfigIndex: number,
): HTMLDivElement => {
    const container = document.createElement("div");
    container.classList.add("chart-container");
    container.style.height = `${chartConfig.height}px`;

    if (isPreview) {
        const dropdownDiv = document.createElement("div");
        dropdownDiv.classList.add("dropdown");

        const dropdownButton = document.createElement("button");
        dropdownButton.classList.add("icon-button");
        dropdownButton.ariaLabel = "Options";
        dropdownButton.ariaExpanded = "false";
        dropdownButton.addEventListener("click", onClickDropdownButton);

        const img = document.createElement("img");
        img.src = imgMoreUrl;
        img.ariaHidden = "true";

        dropdownButton.appendChild(img);

        const dropdownMenu = document.createElement("ul");
        dropdownMenu.classList.add("dropdown-menu", "display-none");

        const liEdit = document.createElement("li");

        const buttonEdit = document.createElement("button");
        buttonEdit.classList.add("dropdown-menu-button");
        buttonEdit.textContent = "Edit";
        buttonEdit.dataset.action = "edit";
        buttonEdit.addEventListener("click", onClickAddEditChart);

        liEdit.appendChild(buttonEdit);

        const liUp = document.createElement("li");

        const buttonUp = document.createElement("button");
        buttonUp.classList.add("dropdown-menu-button");
        buttonUp.textContent = "Move up/left";
        buttonUp.dataset.action = "up";
        buttonUp.addEventListener("click", onClickDropdownItem);

        liUp.appendChild(buttonUp);

        const liDown = document.createElement("li");

        const buttonDown = document.createElement("button");
        buttonDown.classList.add("dropdown-menu-button");
        buttonDown.textContent = "Move down/right";
        buttonDown.dataset.action = "down";
        buttonDown.addEventListener("click", onClickDropdownItem);

        liDown.appendChild(buttonDown);

        const liDelete = document.createElement("li");

        const buttonDelete = document.createElement("button");
        buttonDelete.classList.add("dropdown-menu-button");
        buttonDelete.textContent = "Delete";
        buttonDelete.dataset.action = "delete";
        buttonDelete.addEventListener("click", onClickDropdownItem);

        liDelete.appendChild(buttonDelete);

        dropdownMenu.appendChild(liEdit);
        dropdownMenu.appendChild(liUp);
        dropdownMenu.appendChild(liDown);
        dropdownMenu.appendChild(liDelete);

        dropdownDiv.appendChild(dropdownButton);
        dropdownDiv.appendChild(dropdownMenu);

        container.appendChild(dropdownDiv);

        chartGroupConfigs[groupIndex].chartConfigs[chartConfigIndex] = {
            title: chartConfig.title,
            chartType: chartConfig.chartType,
            dataCount: chartConfig.dataCount,
            maximumValue: chartConfig.maximumValue,
            height: chartConfig.height,
            animationDuration: chartConfig.animationDuration,
            showLegend: chartConfig.showLegend,
            showLabels: chartConfig.showLabels,
            autoColors: chartConfig.autoColors,
            datasets: chartConfig.datasets,
            dropdownButton: dropdownButton,
            dropdownMenu: dropdownMenu,
            dropdownItems: {
                edit: buttonEdit,
                up: buttonUp,
                down: buttonDown,
                delete: buttonDelete,
            },
            chart: null,
        };

        updateDropdownItems(groupIndex);
    }

    const chartTitleId = `chart-title-${chartTitleIdIndex}`;
    chartTitleIdIndex += 1;

    const title = document.createElement("h3");
    title.id = chartTitleId;
    title.classList.add("chart-title");
    title.textContent = chartConfig.title;

    container.appendChild(title);

    const innerContainer = document.createElement("div");

    if (chartConfig.chartType === "table") {
        innerContainer.classList.add("chart-inner-container", "table-overflow");

        const table = document.createElement("table");
        table.classList.add("table-layout");

        const tHead = document.createElement("thead");
        const headRow = document.createElement("tr");
        headRow.appendChild(createTableHeader("Sensor", "col", []));
        headRow.appendChild(
            createTableHeader("Current", "col", ["text-right", "value-cell"]),
        );
        headRow.appendChild(
            createTableHeader("Maximum", "col", ["text-right", "value-cell"]),
        );
        tHead.appendChild(headRow);

        const tBody = document.createElement("tbody");
        const cells = [];
        const lastValues = [];

        for (const dataset of chartConfig.datasets) {
            const tr = document.createElement("tr");

            const th = document.createElement("th");
            th.scope = "row";
            th.textContent = dataset.label;

            const tdCurrent = document.createElement("td");
            const tdMaximum = document.createElement("td");

            const value = formatValue(getRandomNumber(), dataset.unit);

            tdCurrent.textContent = value;
            tdMaximum.textContent = value;

            tr.appendChild(th);
            tr.appendChild(tdCurrent);
            tr.appendChild(tdMaximum);

            tBody.appendChild(tr);

            cells.push(tdCurrent, tdMaximum);
            lastValues.push(-1, -1);
        }

        table.appendChild(tHead);
        table.appendChild(tBody);

        innerContainer.appendChild(table);

        if (!isPreview) {
            chartGroupInfo[groupIndex].charts.push({
                title: chartConfig.title,
                chartType: "table",
                dataCount: chartConfig.dataCount,
                maximumValue: chartConfig.maximumValue,
                height: chartConfig.height,
                animationDuration: chartConfig.animationDuration,
                showLegend: chartConfig.showLegend,
                showLabels: chartConfig.showLabels,
                autoColors: chartConfig.autoColors,
                datasets: chartConfig.datasets,
                indices: new Array(chartConfig.datasets.length).fill(0),
                cells,
                lastValues,
            });
        }
    } else {
        innerContainer.classList.add("chart-inner-container");

        const canvas = document.createElement("canvas");
        canvas.setAttribute("aria-labelledby", chartTitleId);

        if (chartConfig.chartType === "bar") {
            const labels = [];
            const data: Point[] = [];
            const backgroundColors = [];
            const unit = chartConfig.datasets[0].unit;

            for (let i = 0; i < chartConfig.datasets.length; i++) {
                const dataset = chartConfig.datasets[i];

                labels.push(dataset.label);
                data.push({
                    x: i,
                    y: isPreview ? getRandomNumber() : NaN,
                });
                backgroundColors.push(dataset.color);
            }

            const showLegend = chartConfig.showLegend;
            const hasDuplicateColors =
                backgroundColors.length !== new Set(backgroundColors).size;

            const chart = new Chart(canvas, {
                type: "bar",
                data: {
                    labels,
                    datasets: [
                        {
                            data,
                            backgroundColor: backgroundColors,
                            hoverBackgroundColor: backgroundColors,
                            maxBarThickness: 80,
                        },
                    ],
                },
                options: {
                    scales: {
                        x: {
                            ticks: {
                                color: chartTextColor,
                                display: chartConfig.showLabels,
                            },
                            grid: {
                                display: false,
                            },
                            border: {
                                color: chartBorderColor,
                            },
                        },
                        y: {
                            min: 0,
                            ticks: {
                                includeBounds: false,
                                color: chartTextColor,
                            },
                            grid: {
                                color: chartBackgroundColor,
                            },
                            border: {
                                color: chartBorderColor,
                            },
                        },
                    },
                    plugins: {
                        tooltip: {
                            displayColors: false,
                            backgroundColor: chartTooltipBackgroundColor,
                            titleColor: chartTooltipTextColor,
                            bodyColor: chartTooltipTextColor,
                            animation: {
                                duration: chartConfig.animationDuration,
                            },
                            callbacks: {
                                title: (_) => "",
                                label: (item) =>
                                    `${item.label}: ${formatValue((item.raw as Point).y, unit)}`,
                            },
                        },
                        legend: {
                            display: showLegend,
                            position: "bottom",
                            // disable hiding/showing bars on click
                            onClick: (e, __, ___) =>
                                e.native?.stopPropagation(),
                            labels: {
                                padding: 12,
                                usePointStyle: true,
                                // do not show the circle before each label if there are duplicate
                                // colors
                                boxWidth: hasDuplicateColors ? -8 : undefined,
                                boxHeight: hasDuplicateColors ? 0 : undefined,
                                generateLabels: (chart) => {
                                    if (!showLegend) {
                                        return [];
                                    }

                                    const labels: LegendItem[] = [];
                                    const dataset = chart.data.datasets[0];
                                    const dataCount = dataset.data.length;

                                    for (let i = 0; i < dataCount; i++) {
                                        const color = (
                                            dataset.backgroundColor as string[]
                                        )[i];
                                        labels.push({
                                            text: `${chart.data.labels![i]}: ${formatValue((dataset.data[i] as Point).y, unit)}`,
                                            fillStyle: color,
                                            fontColor: chartTextColor,
                                            hidden: false,
                                            strokeStyle: color,
                                        });
                                    }

                                    return labels;
                                },
                            },
                        },
                    },
                    animation: preferReducedMotion
                        ? false
                        : {
                              duration: chartConfig.animationDuration,
                          },
                    parsing: false,
                    normalized: true,
                    maintainAspectRatio: false,
                },
            });

            if (isPreview) {
                chart.options.scales!.y!.max = 10;

                chartGroupConfigs[groupIndex].chartConfigs[
                    chartConfigIndex
                ].chart = chart;
            } else {
                chartGroupInfo[groupIndex].charts.push({
                    title: chartConfig.title,
                    chartType: "bar",
                    dataCount: chartConfig.dataCount,
                    maximumValue: chartConfig.maximumValue,
                    height: chartConfig.height,
                    animationDuration: chartConfig.animationDuration,
                    showLegend: chartConfig.showLegend,
                    showLabels: chartConfig.showLabels,
                    autoColors: chartConfig.autoColors,
                    datasets: chartConfig.datasets,
                    indices: new Array(chartConfig.datasets.length).fill(0),
                    chart,
                    yAxisMax: 0,
                });
            }
        } else if (chartConfig.chartType === "line") {
            const datasets = [];
            const unit = chartConfig.datasets[0].unit;

            for (const dataset of chartConfig.datasets) {
                datasets.push({
                    label: dataset.label,
                    data: [] as Point[],
                    backgroundColor: dataset.color,
                    hoverBackgroundColor: dataset.color,
                    borderColor: dataset.color,
                    hoverBorderColor: dataset.color,
                });
            }

            let timestamp = 0;

            // fill the non-preview line chart with NaN values so new values appear from the right
            // when the chart is empty
            for (let i = 0; i < chartConfig.dataCount; i++) {
                timestamp += 1000; // x axis value must be unique

                const middleIndex = (datasets.length - 1) / 2;

                for (let j = 0; j < datasets.length; j++) {
                    if (isPreview) {
                        let offset = (j - middleIndex) / middleIndex;

                        if (Number.isNaN(offset)) {
                            // happens when datasets.length === 1
                            offset = 0;
                        }

                        // datasets.length === 2 || (datasets.length === 3 && first or last index)
                        if (
                            middleIndex === 0.5 ||
                            (middleIndex === 1 && (j === 0 || j === 2))
                        ) {
                            // make the offset smaller so the lines are closer to the center
                            offset = offset / 2;
                        }

                        datasets[j].data.push({
                            x: timestamp,
                            // Distribute the data evenly. Tthe chart looks messy when using random
                            // generated numbers because the lines intersect a lot.
                            // y = [-1, 1] + 5 + [-4, 4]
                            y: getRandomOffset() + 5 + offset * 4,
                        });
                    } else {
                        datasets[j].data.push({
                            x: timestamp,
                            y: NaN,
                        });
                    }
                }
            }

            const showLegend = chartConfig.showLegend;

            const chart = new Chart(canvas, {
                type: "line",
                data: {
                    datasets,
                },
                options: {
                    scales: {
                        x: {
                            type: "timeseries",
                            time: {
                                tooltipFormat: "HH:mm:ss",
                                unit: "millisecond",
                            },
                            ticks: {
                                display: false,
                                // The callback function is called even when display === false and
                                // Chart._adapters._date.format() is called for each tick.
                                // Overriding the callback function to disable this behavior.
                                callback: (_, __, ___) => {
                                    return null;
                                },
                            },
                            grid: {
                                display: false,
                            },
                            border: {
                                color: chartBorderColor,
                            },
                        },
                        y: {
                            min: 0,
                            ticks: {
                                includeBounds: false,
                                color: chartTextColor,
                            },
                            grid: {
                                color: chartBackgroundColor,
                            },
                            border: {
                                color: chartBorderColor,
                            },
                        },
                    },
                    interaction: {
                        intersect: false,
                        mode: "index",
                    },
                    elements: {
                        line: {
                            borderWidth: 2,
                        },
                        point: {
                            radius: 0,
                            hoverRadius: 0,
                        },
                    },
                    plugins: {
                        tooltip: {
                            position: "middle",
                            backgroundColor: chartTooltipBackgroundColor,
                            titleColor: chartTooltipTextColor,
                            bodyColor: chartTooltipTextColor,
                            boxPadding: 2,
                            usePointStyle: true,
                            animation: {
                                duration: chartConfig.animationDuration,
                            },
                            callbacks: {
                                label: (item) =>
                                    `${item.dataset.label}: ${formatValue((item.raw as Point).y, unit)}`,
                            },
                        },
                        legend: {
                            display: showLegend,
                            position: "bottom",
                            labels: {
                                padding: 12,
                                usePointStyle: true,
                                generateLabels: (chart) => {
                                    if (!showLegend) {
                                        return [];
                                    }

                                    const labels: LegendItem[] = [];
                                    const datasetCount =
                                        chart.data.datasets.length;
                                    const lastDataIndex =
                                        chart.data.datasets[0].data.length - 1;

                                    for (let i = 0; i < datasetCount; i++) {
                                        const dataset = chart.data.datasets[i];
                                        const color =
                                            dataset.backgroundColor!.toString();

                                        labels.push({
                                            text: `${dataset.label!}: ${formatValue((dataset.data[lastDataIndex] as Point).y, unit)}`,
                                            fillStyle: color,
                                            fontColor: chartTextColor,
                                            hidden: !chart.isDatasetVisible(i),
                                            strokeStyle: color,
                                            datasetIndex: i,
                                        });
                                    }

                                    return labels;
                                },
                            },
                        },
                    },
                    animation: preferReducedMotion
                        ? false
                        : {
                              duration: chartConfig.animationDuration,
                          },
                    animations: isPreview
                        ? {}
                        : {
                              y: {
                                  // Disable animation in the y direction. By default, new lines
                                  // added to the chart are drawn at the bottom,then they are
                                  // animated to move towards the correct position.
                                  duration: 0,
                              },
                          },
                    parsing: false,
                    normalized: true,
                    maintainAspectRatio: false,
                },
                plugins: [
                    {
                        id: "verticalLine",
                        beforeTooltipDraw: (chart, args, _) => {
                            // draw a vertical line across the chart at the cursor position
                            // when hovering over the chart

                            const x = args.tooltip?.caretX;

                            if (!x) {
                                return;
                            }

                            const ctx = chart.ctx;

                            ctx.save();

                            ctx.lineWidth = 1;
                            ctx.strokeStyle = chartBackgroundColor;
                            ctx.beginPath();
                            ctx.moveTo(x, chart.chartArea.top);
                            ctx.lineTo(x, chart.chartArea.bottom);
                            ctx.stroke();

                            ctx.restore();
                        },
                    },
                ],
            });

            if (isPreview) {
                chart.options.scales!.y!.max = 10;

                chartGroupConfigs[groupIndex].chartConfigs[
                    chartConfigIndex
                ].chart = chart;
            } else {
                chartGroupInfo[groupIndex].charts.push({
                    title: chartConfig.title,
                    chartType: "line",
                    dataCount: chartConfig.dataCount,
                    maximumValue: chartConfig.maximumValue,
                    height: chartConfig.height,
                    animationDuration: chartConfig.animationDuration,
                    showLegend: chartConfig.showLegend,
                    showLabels: chartConfig.showLabels,
                    autoColors: chartConfig.autoColors,
                    datasets: chartConfig.datasets,
                    indices: new Array(chartConfig.datasets.length).fill(0),
                    chart,
                    yAxisMax: 0,
                });
            }
        } else {
            const unit = chartConfig.datasets[0].unit;
            const randomValue = getRandomNumber();

            const chart = new Chart(canvas, {
                type: "doughnut",
                data: {
                    datasets: [
                        {
                            data: [randomValue, 10 - randomValue],
                            backgroundColor: [
                                chartConfig.datasets[0].color,
                                colors[7],
                            ],
                        },
                    ],
                },
                options: {
                    elements: {
                        arc: {
                            borderWidth: 0,
                        },
                    },
                    plugins: {
                        tooltip: {
                            enabled: false,
                        },
                        legend: {
                            display: false,
                        },
                    },
                    layout: {
                        padding: {
                            top: 6,
                            bottom: 12,
                            left: 4,
                            right: 4,
                        },
                    },
                    cutout: "90%",
                    rotation: 240,
                    circumference: 240,
                    events: [],
                    animation: preferReducedMotion
                        ? false
                        : {
                              duration: chartConfig.animationDuration,
                          },
                    parsing: false,
                    normalized: true,
                    maintainAspectRatio: false,
                },
                plugins: [
                    {
                        id: "gaugeText",
                        beforeDatasetsDraw: (chart, _, __) => {
                            // draw the value near the middle of the chart

                            const x = chart.chartArea.width / 2;
                            const y = chart.chartArea.height / 2 + 35;

                            const ctx = chart.ctx;
                            ctx.save();

                            ctx.font = `2.25rem ${Chart.defaults.font.family}`;
                            ctx.fillStyle = chartTextColor;
                            ctx.textAlign = "center";
                            ctx.fillText(
                                formatValue(
                                    chart.data.datasets[0].data[0],
                                    unit,
                                ),
                                x,
                                y,
                            );

                            ctx.restore();
                        },
                    },
                ],
            });

            if (isPreview) {
                chartGroupConfigs[groupIndex].chartConfigs[
                    chartConfigIndex
                ].chart = chart;
            } else {
                chartGroupInfo[groupIndex].charts.push({
                    title: chartConfig.title,
                    chartType: "gauge",
                    dataCount: chartConfig.dataCount,
                    maximumValue: chartConfig.maximumValue,
                    height: chartConfig.height,
                    animationDuration: chartConfig.animationDuration,
                    showLegend: chartConfig.showLegend,
                    showLabels: chartConfig.showLabels,
                    autoColors: chartConfig.autoColors,
                    datasets: chartConfig.datasets,
                    indices: new Array(chartConfig.datasets.length).fill(0),
                    chart,
                });
            }
        }

        innerContainer.appendChild(canvas);
    }

    container.appendChild(innerContainer);

    return container;
};

const updateDropdownItems = (groupConfigIndex: number) => {
    const groupConfig = chartGroupConfigs[groupConfigIndex];
    const configCount = groupConfig.chartConfigs.length;
    const groupIndexStr = groupConfigIndex.toString();

    for (let i = 0; i < configCount; i++) {
        const config = groupConfig.chartConfigs[i];
        const chartIndexStr = i.toString();
        const dropdownItems = config.dropdownItems;

        config.dropdownButton.dataset.groupIndex = groupIndexStr;
        config.dropdownButton.dataset.configIndex = chartIndexStr;

        dropdownItems.edit.dataset.groupIndex = groupIndexStr;
        dropdownItems.edit.dataset.configIndex = chartIndexStr;

        dropdownItems.up.disabled = i === 0;
        dropdownItems.up.dataset.groupIndex = groupIndexStr;
        dropdownItems.up.dataset.configIndex = chartIndexStr;

        dropdownItems.down.disabled = i === configCount - 1;
        dropdownItems.down.dataset.groupIndex = groupIndexStr;
        dropdownItems.down.dataset.configIndex = chartIndexStr;

        dropdownItems.delete.dataset.groupIndex = groupIndexStr;
        dropdownItems.delete.dataset.configIndex = chartIndexStr;
    }
};

const onClickDropdownItem = (ev: MouseEvent) => {
    ev.stopPropagation();

    const e = ev.currentTarget as HTMLElement;
    const action = e.dataset.action;
    const groupConfigIndex = Number(e.dataset.groupIndex);
    const configIndex = Number(e.dataset.configIndex);
    const groupConfig = chartGroupConfigs[groupConfigIndex];

    if (action === "up") {
        const chartContainers = groupConfig.chartContainers;
        const chartConfigs = groupConfig.chartConfigs;

        [chartContainers[configIndex - 1], chartContainers[configIndex]] = [
            chartContainers[configIndex],
            chartContainers[configIndex - 1],
        ];
        [chartConfigs[configIndex - 1], chartConfigs[configIndex]] = [
            chartConfigs[configIndex],
            chartConfigs[configIndex - 1],
        ];

        const chartContainer = chartContainers[configIndex - 1];
        chartContainer.classList.add("container-move-up");
        chartContainer.addEventListener(
            "animationend",
            (_) => {
                chartContainer.classList.remove("container-move-up");
            },
            { once: true },
        );

        chartContainer.after(chartContainers[configIndex]);
        chartContainer.scrollIntoView({ block: "nearest" });

        updateDropdownItems(groupConfigIndex);
    } else if (action === "down") {
        const chartContainers = groupConfig.chartContainers;
        const chartConfigs = groupConfig.chartConfigs;

        [chartContainers[configIndex], chartContainers[configIndex + 1]] = [
            chartContainers[configIndex + 1],
            chartContainers[configIndex],
        ];
        [chartConfigs[configIndex], chartConfigs[configIndex + 1]] = [
            chartConfigs[configIndex + 1],
            chartConfigs[configIndex],
        ];

        const chartContainer = chartContainers[configIndex + 1];
        chartContainer.classList.add("container-move-down");
        chartContainer.addEventListener(
            "animationend",
            (_) => {
                chartContainer.classList.remove("container-move-down");
            },
            { once: true },
        );

        chartContainer.before(chartContainers[configIndex]);
        chartContainer.scrollIntoView({ block: "nearest" });

        updateDropdownItems(groupConfigIndex);
    } else {
        // action === "delete"

        createDialog(
            "delete-dialog",
            "Delete this chart?",
            false,
            true,
            true,
            [createDialogText("This action cannot be undone")],
            [
                {
                    id: null,
                    text: "No",
                    isGreen: false,
                    autoFocus: true,
                    onClick: (close) => close(),
                },
                {
                    id: null,
                    text: "Yes",
                    isGreen: false,
                    autoFocus: false,
                    onClick: (close) => {
                        groupConfig.chartContainers
                            .splice(configIndex, 1)[0]
                            .remove();
                        groupConfig.chartConfigs.splice(configIndex, 1);

                        updateDropdownItems(groupConfigIndex);

                        close();
                    },
                },
            ],
        );
    }
};

const getScreenWidth = (): ScreenWidth => {
    const width = window.innerWidth;

    if (width < 768) {
        return "tiny";
    } else if (width < 992) {
        return "small";
    } else if (width < 1400) {
        return "medium";
    } else if (width < 1880) {
        return "large";
    }

    return "extraLarge";
};

const configureGrid = (
    gridContainer: HTMLDivElement,
    gridBreakpoints: GridBreakpoints,
    screenWidth: ScreenWidth,
) => {
    let columnCount: number;
    let width: number;

    if (screenWidth === "tiny") {
        columnCount = 1;
        width = 0;
    } else {
        columnCount =
            gridBreakpoints[(screenWidth + "Columns") as keyof GridBreakpoints];
        width =
            gridBreakpoints[(screenWidth + "Width") as keyof GridBreakpoints];
    }

    gridContainer.style.gridTemplateColumns = `repeat(${columnCount}, minmax(0, 1fr))`;

    if (width === 0) {
        gridContainer.style.removeProperty("width");
        gridContainer.style.removeProperty("margin-left");
        gridContainer.style.removeProperty("margin-right");
    } else {
        gridContainer.style.width = `${width}px`;
        gridContainer.style.marginLeft = "auto";
        gridContainer.style.marginRight = "auto";
    }
};

const onClickDropdownButton = (ev: MouseEvent) => {
    ev.stopPropagation();

    const e = ev.currentTarget as HTMLElement;
    const dropdownMenu =
        chartGroupConfigs[Number(e.dataset.groupIndex)].chartConfigs[
            Number(e.dataset.configIndex)
        ].dropdownMenu;

    if (dropdownMenu.classList.contains("display-none")) {
        e.ariaExpanded = "true";
        dropdownMenu.classList.remove("display-none");

        // close the dropdown menu when a click event happens anywhere on the page
        document.addEventListener(
            "click",
            (_) => {
                e.ariaExpanded = "false";
                dropdownMenu.classList.add("display-none");
            },
            { capture: true, once: true },
        );
    }
};

/**
 * Returns a number between 0 and 10 inclusive.
 */
const getRandomNumber = (): number => Math.random() * 9 + 1;

/**
 * Returns a number between -1 and 1 inclusive.
 */
const getRandomOffset = (): number => {
    if (Math.random() < 0.5) {
        return -Math.random();
    }

    return Math.random();
};

const updateIndices = (sensors: SensorInfo) => {
    // eslint-disable-next-line @typescript-eslint/prefer-for-of
    for (let i = 0; i < chartGroupInfo.length; i++) {
        const group = chartGroupInfo[i];

        // eslint-disable-next-line @typescript-eslint/prefer-for-of
        for (let j = 0; j < group.charts.length; j++) {
            const chart = group.charts[j];

            for (let k = 0; k < chart.datasets.length; k++) {
                // get the dataset of every chart in every group
                const dataset = chart.datasets[k];

                let readingIndex = -1;

                // eslint-disable-next-line @typescript-eslint/prefer-for-of
                for (let l = 0; l < sensors.sensors.length; l++) {
                    const sensor = sensors.sensors[l];

                    if (
                        sensor.id === dataset.sensorId &&
                        sensor.instance === dataset.sensorInstance
                    ) {
                        for (let m = 0; m < sensor.readings.length; m++) {
                            if (sensor.readings[m].id === dataset.readingId) {
                                // correct reading found
                                readingIndex = sensor.offset + m * 2;

                                break;
                            }
                        }

                        break;
                    }
                }

                chart.indices[k] = readingIndex;
            }
        }
    }
};

window.addEventListener("resize", (_) => {
    const screenWidth = getScreenWidth();

    for (const groupConfig of chartGroupConfigs) {
        configureGrid(
            groupConfig.gridContainer,
            groupConfig.gridBreakpoints,
            screenWidth,
        );
    }

    for (const group of chartGroupInfo) {
        configureGrid(group.container, group.gridBreakpoints, screenWidth);
    }
});

const updateChartColors = () => {
    const colors = getChartColors();
    chartTextColor = colors.text;
    chartBackgroundColor = colors.background;
    chartBorderColor = colors.border;
    chartTooltipBackgroundColor = colors.tooltipBackground;
    chartTooltipTextColor = colors.tooltipText;

    // update colors and redraw the charts without animation
    for (const groupConfig of chartGroupConfigs) {
        for (const chartConfig of groupConfig.chartConfigs) {
            const chart = chartConfig.chart;

            if (chart) {
                if (
                    chartConfig.chartType === "bar" ||
                    chartConfig.chartType === "line"
                ) {
                    chart.options.scales!.x!.ticks!.color = chartTextColor;
                    chart.options.scales!.x!.border!.color = chartBorderColor;
                    chart.options.scales!.y!.ticks!.color = chartTextColor;
                    chart.options.scales!.y!.grid!.color = chartBackgroundColor;
                    chart.options.scales!.y!.border!.color = chartBorderColor;
                    chart.options.plugins!.tooltip!.backgroundColor =
                        chartTooltipBackgroundColor;
                    chart.options.plugins!.tooltip!.titleColor =
                        chartTooltipTextColor;
                    chart.options.plugins!.tooltip!.bodyColor =
                        chartTooltipTextColor;
                }

                chart.update("none");
            }
        }
    }

    for (const group of chartGroupInfo) {
        for (const chart of group.charts) {
            if (chart.chartType === "bar" || chart.chartType === "line") {
                chart.chart.options.scales!.x!.ticks!.color = chartTextColor;
                chart.chart.options.scales!.x!.border!.color = chartBorderColor;
                chart.chart.options.scales!.y!.ticks!.color = chartTextColor;
                chart.chart.options.scales!.y!.grid!.color =
                    chartBackgroundColor;
                chart.chart.options.scales!.y!.border!.color = chartBorderColor;
                chart.chart.options.plugins!.tooltip!.backgroundColor =
                    chartTooltipBackgroundColor;
                chart.chart.options.plugins!.tooltip!.titleColor =
                    chartTooltipTextColor;
                chart.chart.options.plugins!.tooltip!.bodyColor =
                    chartTooltipTextColor;

                chart.chart.update("none");
            } else if (chart.chartType === "gauge") {
                chart.chart.update("none");
            }
        }
    }
};

window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", (_) => {
        updateChartColors();
    });

window
    .matchMedia("(prefers-reduced-motion: reduce)")
    .addEventListener("change", (ev) => {
        preferReducedMotion = ev.matches;

        for (const group of chartGroupInfo) {
            for (const chart of group.charts) {
                if (
                    chart.chartType === "bar" ||
                    chart.chartType === "line" ||
                    chart.chartType === "gauge"
                ) {
                    chart.chart.options.animation = preferReducedMotion
                        ? false
                        : {
                              duration: chart.animationDuration,
                          };
                }
            }
        }
    });

export { show, update };

interface GridBreakpoints {
    // min width of 768px
    smallColumns: number;
    smallWidth: number;
    // min width of 992px
    mediumColumns: number;
    mediumWidth: number;
    // min width of 1400px
    largeColumns: number;
    largeWidth: number;
    // min width of 1880px
    extraLargeColumns: number;
    extraLargeWidth: number;
}

interface ChartConfig {
    title: string;
    chartType: "bar" | "line" | "gauge" | "table";
    dataCount: number; // number of data points in line chart
    maximumValue: number; // max value for gauge chart
    height: number;
    animationDuration: number;
    showLegend: boolean; // for bar and line charts
    showLabels: boolean; // for bar charts
    autoColors: boolean;
    datasets: {
        sensorId: number;
        sensorInstance: number;
        readingId: number;
        label: string;
        unit: string;
        color: string;
    }[];
}

interface ChartGroupConfig {
    gridBreakpoints: GridBreakpoints;
    chartConfigs: ChartConfig[];
}

interface ChartGroupConfigWithRefs extends ChartGroupConfig {
    container: HTMLDivElement;
    card: HTMLDivElement;
    gridContainer: HTMLDivElement;
    chartContainers: HTMLDivElement[];
    buttonRow: {
        grid: HTMLButtonElement;
        add: HTMLButtonElement;
    };
    buttonGroup: {
        up: HTMLButtonElement;
        down: HTMLButtonElement;
        delete: HTMLButtonElement;
    };
    chartConfigs: ChartConfigWithRefs[];
}

interface ChartConfigWithRefs extends ChartConfig {
    dropdownButton: HTMLButtonElement;
    dropdownMenu: HTMLUListElement;
    dropdownItems: {
        edit: HTMLButtonElement;
        up: HTMLButtonElement;
        down: HTMLButtonElement;
        delete: HTMLButtonElement;
    };
    chart: Chart<
        "bar" | "line" | "doughnut",
        Point[] | number[],
        unknown
    > | null;
}

type ChartInfo = ChartInfoBarLineChart | ChartInfoGaugeChart | ChartInfoTable;

interface ChartInfoBarLineChart extends ChartConfig {
    chartType: "bar" | "line";
    indices: number[];
    chart: Chart<"bar" | "line", Point[], unknown>;
    yAxisMax: number; // maximum y value
}

interface ChartInfoGaugeChart extends ChartConfig {
    chartType: "gauge";
    indices: number[];
    chart: Chart<"doughnut", number[], unknown>;
}

interface ChartInfoTable extends ChartConfig {
    chartType: "table";
    indices: number[];
    cells: HTMLTableCellElement[];
    lastValues: number[];
}

interface ChartGroupInfo {
    container: HTMLDivElement;
    gridBreakpoints: GridBreakpoints;
    charts: ChartInfo[];
}

type ScreenWidth = "tiny" | "small" | "medium" | "large" | "extraLarge";

declare module "chart.js" {
    interface TooltipPositionerMap {
        middle: TooltipPositionerFunction<ChartType>;
    }
}
