const configureThemeSelect = (select: HTMLSelectElement) => {
    select.addEventListener("change", (ev) => {
        ev.stopPropagation();

        const newTheme = select.value;

        if (newTheme === "auto") {
            document.documentElement.removeAttribute("data-theme");
        } else {
            document.documentElement.setAttribute("data-theme", newTheme);
        }

        localStorage.setItem("theme", newTheme);
    });

    // the theme is set to the value of `data-theme` attribute in `index.html`, when theme is not auto
    const currentTheme = document.documentElement.dataset.theme ?? "auto";

    select.appendChild(
        createSelectOption(
            "Auto",
            "auto",
            currentTheme === "auto",
            false,
            false,
        ),
    );
    select.appendChild(
        createSelectOption(
            "Light",
            "light",
            currentTheme === "light",
            false,
            false,
        ),
    );
    select.appendChild(
        createSelectOption(
            "Dark",
            "dark",
            currentTheme === "dark",
            false,
            false,
        ),
    );
};

/**
 * Returns a label element and a select element for changing theme.
 */
const getThemeLabelSelect = (): HTMLElement[] => {
    const labelTheme = createLabel("Theme", "theme-select", true);

    const selectTheme = document.createElement("select");
    selectTheme.id = "theme-select";

    configureThemeSelect(selectTheme);

    return [labelTheme, selectTheme];
};

const createSelectOption = (
    text: string,
    value: string,
    selected: boolean,
    hidden: boolean,
    disabled: boolean,
): HTMLOptionElement => {
    const option = document.createElement("option");
    option.textContent = text;
    option.value = value;
    option.selected = selected;
    option.hidden = hidden;
    option.disabled = disabled;

    return option;
};

const createLabel = (
    text: string,
    htmlFor: string,
    removeTopMargin: boolean,
): HTMLLabelElement => {
    const label = document.createElement("label");
    label.textContent = text;
    label.htmlFor = htmlFor;

    if (removeTopMargin) {
        label.classList.add("margin-top-none");
    }

    return label;
};

/**
 * Returns an input element with `inputMode` set to number.
 */
const createNumberInput = (
    id: string,
    placeholder: string,
    describedBy: string,
): HTMLInputElement => {
    const input = document.createElement("input");
    input.id = id;
    input.type = "text";
    input.inputMode = "number";
    input.placeholder = placeholder;
    input.setAttribute("aria-describedby", describedBy);

    return input;
};

const createHint = (id: string, text: string): HTMLElement => {
    const hint = document.createElement("small");
    hint.id = id;
    hint.textContent = text;

    return hint;
};

const createTableHeader = (
    name: string,
    scope: string,
    classes: string[],
): HTMLTableCellElement => {
    const th = document.createElement("th");
    th.scope = scope;
    th.classList.add(...classes);
    th.textContent = name;

    return th;
};

/**
 * Creates a dialog element.
 *
 * @param showNow If set to `false`, use `showDialog()` to show the dialog.
 * @param removeOnClose Remove the dialog element from the DOM after closing the dialog.
 */
const createDialog = (
    id: string,
    title: string,
    wideDialog: boolean,
    showNow: boolean,
    removeOnClose: boolean,
    bodyElements: HTMLElement[],
    buttons: {
        id: string | null;
        text: string;
        isGreen: boolean;
        autoFocus: boolean;
        /**
         * @param close Closes the dialog.
         */
        onClick: (close: () => void) => void;
    }[],
) => {
    const dialogTitleId = `${id}-title`;

    const dialog = document.createElement("dialog");
    dialog.id = id;
    dialog.setAttribute("aria-labelledby", dialogTitleId);
    dialog.tabIndex = -1; // prevent the dialog element itself from being focusable
    dialog.addEventListener("cancel", (ev) => {
        ev.preventDefault();

        // do not close the dialog if there is no dialog button
        if (buttons.length > 0) {
            closeModal();
        }
    });

    if (wideDialog) {
        dialog.classList.add("dialog-wide");
    }

    if (removeOnClose) {
        dialog.addEventListener("close", (_) => {
            dialog.remove();
        });
    }

    const dialogTitle = document.createElement("h2");
    dialogTitle.id = dialogTitleId;
    dialogTitle.classList.add("dialog-title");
    dialogTitle.textContent = title;

    const dialogBody = document.createElement("div");
    dialogBody.classList.add("dialog-body");

    for (const element of bodyElements) {
        dialogBody.appendChild(element);
    }

    const closeModal = () => {
        dialog.addEventListener(
            "transitionend",
            (_) => {
                dialog.close();

                document.body.style.removeProperty("overflow");
                document.body.style.removeProperty("padding-right");
            },
            { once: true },
        );

        dialog.classList.remove("dialog-show");
    };

    dialog.appendChild(dialogTitle);
    dialog.appendChild(dialogBody);

    if (buttons.length === 0) {
        dialogBody.style.borderBottom = "none";
    } else {
        const dialogButtons = document.createElement("div");
        dialogButtons.classList.add("dialog-buttons");

        for (const button of buttons) {
            const btn = document.createElement("button");

            if (button.id) {
                btn.id = button.id;
            }

            if (button.isGreen) {
                btn.classList.add("green-button");
            }

            if (button.autoFocus) {
                btn.setAttribute("autofocus", "");
            }

            btn.textContent = button.text;
            btn.addEventListener("click", (ev) => {
                ev.stopPropagation();

                button.onClick(closeModal);
            });

            dialogButtons.appendChild(btn);
        }

        dialog.appendChild(dialogButtons);
    }

    document.body.appendChild(dialog);

    if (showNow) {
        showDialog(dialog);
    }
};

const showDialog = (dialog: HTMLDialogElement) => {
    const scrollBarWidth = Math.abs(
        window.innerWidth - document.documentElement.clientWidth,
    );

    // prevent the page from scrolling, and add a padding to replace the scroll bar so the page does
    // not shift
    document.body.style.overflow = "hidden";
    document.body.style.paddingRight = `${scrollBarWidth}px`;

    dialog.showModal();
    dialog.classList.add("dialog-show");
    dialog
        .getElementsByClassName("dialog-body")[0]
        .scrollTo({ top: 0, behavior: "instant" });
};

const createDialogText = (text: string): HTMLParagraphElement => {
    const p = document.createElement("p");
    p.classList.add("dialog-text");
    p.textContent = text;

    return p;
};

/**
 * Adds text elements to `container` to show no sensor is found.
 */
const addEmptySensorTexts = (container: HTMLElement, hasFooter: boolean) => {
    const textTop = document.createElement("h2");
    textTop.classList.add("empty-container-text-top");
    textTop.textContent = "No sensor found";

    const textBottom = document.createElement("p");
    textBottom.classList.add("empty-container-text-bottom");
    textBottom.textContent = "Make sure to enable monitoring for sensors";

    container.classList.add("empty-container");

    if (hasFooter) {
        container.style.height = "calc(100vh - 3rem)";
    }

    container.appendChild(textTop);
    container.appendChild(textBottom);
};

const formatValue = (value: number, unit: string): string => {
    if (unit === "Yes/No") {
        return value === 0 ? "No" : "Yes";
    }

    // value is `NaN` if the reading is not found
    if (Number.isNaN(value)) {
        return "-";
    }

    let digits;
    switch (unit) {
        case "%":
        case "MHz":
        case "x":
        case "°C":
        case "°F":
        case "":
        case "GT/s":
        case "FPS":
            digits = 1;
            break;
        case "V":
        case "A":
        case "W":
        case "GB/s":
        case "MB/s":
        case "KB/s":
            digits = 3;
            break;
        case "ms":
            digits = 2;
            break;
        default:
            digits = 0;
    }

    return `${value.toFixed(digits)} ${unit}`;
};

export {
    configureThemeSelect,
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
};
