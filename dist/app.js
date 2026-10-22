const textA = document.querySelector("#text-a");
const textB = document.querySelector("#text-b");
const countA = document.querySelector("#count-a");
const countB = document.querySelector("#count-b");
const compareButton = document.querySelector("#compare-button");
const workspace = document.querySelector(".comparison-workspace");
const textTab = document.querySelector("#tab-text");
const resultsTab = document.querySelector("#tab-results");
const textPanel = document.querySelector("#text-panel");
const results = document.querySelector("#results");
const resultTitle = document.querySelector("#result-title");
const resultStats = document.querySelector("#result-stats");
const diffGrid = document.querySelector("#diff-grid");
const diffA = document.querySelector("#diff-a");
const diffB = document.querySelector("#diff-b");
const codeA = diffA.querySelector("code");
const codeB = diffB.querySelector("code");
const navigationPositions = { added: 0, removed: 0, changed: 0 };

function characterLabel(value) {
  return `${value.length.toLocaleString("es")} ${value.length === 1 ? "carácter" : "caracteres"}`;
}

function updateCounts() {
  countA.textContent = characterLabel(textA.value);
  countB.textContent = characterLabel(textB.value);
}

function activateTab(name, focusTab = false) {
  const showResults = name === "results";

  if (showResults && resultsTab.disabled) return;

  textPanel.hidden = showResults;
  results.hidden = !showResults;
  textTab.setAttribute("aria-selected", String(!showResults));
  resultsTab.setAttribute("aria-selected", String(showResults));
  textTab.tabIndex = showResults ? -1 : 0;
  resultsTab.tabIndex = showResults ? 0 : -1;

  if (focusTab) {
    (showResults ? resultsTab : textTab).focus();
  }
}

function handleTabKeydown(event) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;

  const availableTabs = [textTab, resultsTab].filter((tab) => !tab.disabled);
  const currentIndex = availableTabs.indexOf(document.activeElement);
  let nextIndex = currentIndex;

  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = availableTabs.length - 1;
  if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % availableTabs.length;
  if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + availableTabs.length) % availableTabs.length;

  event.preventDefault();
  const nextTab = availableTabs[nextIndex];
  activateTab(nextTab === resultsTab ? "results" : "text", true);
}

function splitLines(value) {
  return value === "" ? [] : value.replace(/\r\n?/g, "\n").split("\n");
}

function valueAt(map, key) {
  return map.has(key) ? map.get(key) : Number.NEGATIVE_INFINITY;
}

function buildLineDiff(before, after) {
  const first = splitLines(before);
  const second = splitLines(after);
  const maximum = first.length + second.length;
  let frontier = new Map([[1, 0]]);
  const history = [];

  for (let distance = 0; distance <= maximum; distance += 1) {
    history.push(new Map(frontier));

    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const moveDown =
        diagonal === -distance ||
        (diagonal !== distance && valueAt(frontier, diagonal - 1) < valueAt(frontier, diagonal + 1));
      let x = moveDown ? valueAt(frontier, diagonal + 1) : valueAt(frontier, diagonal - 1) + 1;
      let y = x - diagonal;

      while (x < first.length && y < second.length && first[x] === second[y]) {
        x += 1;
        y += 1;
      }

      frontier.set(diagonal, x);

      if (x >= first.length && y >= second.length) {
        return backtrackDiff(history, first, second);
      }
    }
  }

  return [];
}

function backtrackDiff(history, first, second) {
  let x = first.length;
  let y = second.length;
  const edits = [];

  for (let distance = history.length - 1; distance >= 0; distance -= 1) {
    const frontier = history[distance];
    const diagonal = x - y;
    const moveDown =
      diagonal === -distance ||
      (diagonal !== distance && valueAt(frontier, diagonal - 1) < valueAt(frontier, diagonal + 1));
    const previousDiagonal = moveDown ? diagonal + 1 : diagonal - 1;
    const previousX = distance === 0 ? 0 : valueAt(frontier, previousDiagonal);
    const previousY = distance === 0 ? 0 : previousX - previousDiagonal;

    while (x > previousX && y > previousY) {
      edits.push({ type: "equal", value: first[x - 1] });
      x -= 1;
      y -= 1;
    }

    if (distance === 0) {
      break;
    }

    if (x === previousX) {
      edits.push({ type: "add", value: second[y - 1] });
      y -= 1;
    } else {
      edits.push({ type: "remove", value: first[x - 1] });
      x -= 1;
    }
  }

  return edits.reverse();
}

function alignDiff(edits) {
  const rows = [];
  let index = 0;

  while (index < edits.length) {
    if (edits[index].type === "equal") {
      rows.push({ type: "equal", left: edits[index].value, right: edits[index].value });
      index += 1;
      continue;
    }

    const removed = [];
    const added = [];

    while (index < edits.length && edits[index].type !== "equal") {
      if (edits[index].type === "remove") {
        removed.push(edits[index].value);
      } else {
        added.push(edits[index].value);
      }
      index += 1;
    }

    const groupLength = Math.max(removed.length, added.length);

    for (let groupIndex = 0; groupIndex < groupLength; groupIndex += 1) {
      const left = removed[groupIndex];
      const right = added[groupIndex];

      if (left !== undefined && right !== undefined) {
        rows.push({ type: "change", left, right });
      } else if (left !== undefined) {
        rows.push({ type: "remove", left, right: null });
      } else {
        rows.push({ type: "add", left: null, right });
      }
    }
  }

  return rows;
}

function tokenize(value) {
  return value.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) || [];
}

function buildTokenDiff(before, after) {
  const first = tokenize(before);
  const second = tokenize(after);

  if (first.length * second.length > 120000) {
    return {
      left: [{ value: before, changed: true }],
      right: [{ value: after, changed: true }],
    };
  }

  const rows = first.length + 1;
  const columns = second.length + 1;
  const matrix = Array.from({ length: rows }, () => new Uint16Array(columns));

  for (let row = first.length - 1; row >= 0; row -= 1) {
    for (let column = second.length - 1; column >= 0; column -= 1) {
      matrix[row][column] = first[row] === second[column]
        ? matrix[row + 1][column + 1] + 1
        : Math.max(matrix[row + 1][column], matrix[row][column + 1]);
    }
  }

  const left = [];
  const right = [];
  let row = 0;
  let column = 0;

  while (row < first.length || column < second.length) {
    if (row < first.length && column < second.length && first[row] === second[column]) {
      left.push({ value: first[row], changed: false });
      right.push({ value: second[column], changed: false });
      row += 1;
      column += 1;
    } else if (column < second.length && (row === first.length || matrix[row][column + 1] >= matrix[row + 1][column])) {
      right.push({ value: second[column], changed: true });
      column += 1;
    } else {
      left.push({ value: first[row], changed: true });
      row += 1;
    }
  }

  return { left, right };
}

function appendTokens(container, tokens, className) {
  tokens.forEach((token) => {
    if (!token.changed) {
      container.append(document.createTextNode(token.value));
      return;
    }

    const mark = document.createElement("mark");
    mark.className = className;
    mark.textContent = token.value;
    container.append(mark);
  });
}

function createLine({ number, sign, value, className, tokens, tokenClass }) {
  const line = document.createElement("span");
  line.className = `diff-line ${className}`;

  const lineNumber = document.createElement("span");
  lineNumber.className = "line-number";
  lineNumber.textContent = number ?? "";

  const lineSign = document.createElement("span");
  lineSign.className = "line-sign";
  lineSign.textContent = sign;

  const content = document.createElement("span");
  content.className = "line-content";

  if (tokens) {
    appendTokens(content, tokens, tokenClass);
  } else {
    content.textContent = value ?? "";
  }

  line.append(lineNumber, lineSign, content);
  return line;
}

function renderRows(rows) {
  const leftFragment = document.createDocumentFragment();
  const rightFragment = document.createDocumentFragment();
  const stats = { added: 0, removed: 0, changed: 0 };
  let leftNumber = 0;
  let rightNumber = 0;

  rows.forEach((row) => {
    if (row.type === "equal") {
      leftNumber += 1;
      rightNumber += 1;
      leftFragment.append(createLine({ number: leftNumber, sign: "", value: row.left, className: "line-equal" }));
      rightFragment.append(createLine({ number: rightNumber, sign: "", value: row.right, className: "line-equal" }));
      return;
    }

    if (row.type === "remove") {
      leftNumber += 1;
      stats.removed += 1;
      leftFragment.append(createLine({ number: leftNumber, sign: "−", value: row.left, className: "line-removed" }));
      rightFragment.append(createLine({ number: null, sign: "", value: "", className: "line-empty" }));
      return;
    }

    if (row.type === "add") {
      rightNumber += 1;
      stats.added += 1;
      leftFragment.append(createLine({ number: null, sign: "", value: "", className: "line-empty" }));
      rightFragment.append(createLine({ number: rightNumber, sign: "+", value: row.right, className: "line-added" }));
      return;
    }

    leftNumber += 1;
    rightNumber += 1;
    stats.changed += 1;
    const tokenDiff = buildTokenDiff(row.left, row.right);
    leftFragment.append(createLine({
      number: leftNumber,
      sign: "−",
      className: "line-changed-left",
      tokens: tokenDiff.left,
      tokenClass: "word-removed",
    }));
    rightFragment.append(createLine({
      number: rightNumber,
      sign: "+",
      className: "line-changed-right",
      tokens: tokenDiff.right,
      tokenClass: "word-added",
    }));
  });

  codeA.replaceChildren(leftFragment);
  codeB.replaceChildren(rightFragment);
  return stats;
}

function resetNavigation() {
  Object.keys(navigationPositions).forEach((type) => {
    navigationPositions[type] = 0;
  });

  document.querySelectorAll(".diff-line.is-current").forEach((line) => {
    line.classList.remove("is-current");
  });
}

function scrollLineIntoPane(pane, line, behavior) {
  const paneRect = pane.getBoundingClientRect();
  const lineRect = line.getBoundingClientRect();
  const lineTop = pane.scrollTop + lineRect.top - paneRect.top;
  const centeredTop = lineTop - (pane.clientHeight - lineRect.height) / 2;

  pane.scrollTo({ top: Math.max(0, centeredTop), behavior });
}

function navigateToChange(type, button) {
  const configurations = {
    added: { pane: diffB, selector: ".line-added", label: "agregada" },
    removed: { pane: diffA, selector: ".line-removed", label: "eliminada" },
    changed: { pane: diffB, selector: ".line-changed-right", label: "modificada" },
  };
  const configuration = configurations[type];
  const lines = Array.from(configuration.pane.querySelectorAll(configuration.selector));

  if (lines.length === 0) return;

  const position = navigationPositions[type] % lines.length;
  const target = lines[position];
  const rowIndex = Array.from(target.parentElement.children).indexOf(target);

  navigationPositions[type] = (position + 1) % lines.length;
  document.querySelectorAll(".diff-line.is-current").forEach((line) => {
    line.classList.remove("is-current");
  });
  resultStats.querySelectorAll(".stat.is-active").forEach((stat) => {
    stat.classList.remove("is-active");
  });

  const leftLine = codeA.children[rowIndex];
  const rightLine = codeB.children[rowIndex];

  leftLine?.classList.add("is-current");
  rightLine?.classList.add("is-current");
  button.classList.add("is-active");
  button.setAttribute(
    "aria-label",
    `Línea ${configuration.label} ${position + 1} de ${lines.length}. Ir a la siguiente.`,
  );

  scrollLineIntoPane(configuration.pane, target, "auto");
}

function renderStats(stats) {
  resultStats.innerHTML = "";
  const items = [
    ["added", stats.added, `+${stats.added}`, "agregadas"],
    ["removed", stats.removed, `+${stats.removed}`, "eliminadas"],
    ["changed", stats.changed, `~${stats.changed}`, "modificadas"],
  ];

  items.forEach(([type, count, label, description]) => {
    const stat = document.createElement("button");
    stat.type = "button";
    stat.className = `stat stat-${type}`;
    stat.textContent = label;
    stat.disabled = count === 0;
    stat.title = count === 0
      ? `No hay líneas ${description}`
      : `Ir a la siguiente línea ${description.slice(0, -1)}`;
    stat.setAttribute(
      "aria-label",
      count === 0
        ? `No hay líneas ${description}`
        : `${count} líneas ${description}. Ir a la primera; los clics siguientes avanzan.`,
    );
    stat.addEventListener("click", () => navigateToChange(type, stat));
    resultStats.append(stat);
  });
}

function compareTexts() {
  const before = textA.value;
  const after = textB.value;
  const identical = before === after;

  resetNavigation();
  diffGrid.hidden = identical;
  resultStats.hidden = identical;
  resultTitle.hidden = !identical;

  if (identical) {
    resultTitle.textContent = "Sin diferencias";
  } else {
    const edits = buildLineDiff(before, after);
    const rows = alignDiff(edits);
    const stats = renderRows(rows);
    renderStats(stats);
    diffA.scrollTop = 0;
    diffB.scrollTop = 0;
    diffA.scrollLeft = 0;
    diffB.scrollLeft = 0;
  }

  resultsTab.disabled = false;
  activateTab("results");
  workspace.scrollIntoView({ behavior: "smooth", block: "start" });
}

function syncScroll(source, target) {
  source.addEventListener("scroll", () => {
    if (target.scrollTop !== source.scrollTop) {
      target.scrollTop = source.scrollTop;
    }
    if (target.scrollLeft !== source.scrollLeft) {
      target.scrollLeft = source.scrollLeft;
    }
  });
}

textA.addEventListener("input", updateCounts);
textB.addEventListener("input", updateCounts);
compareButton.addEventListener("click", compareTexts);
textTab.addEventListener("click", () => activateTab("text"));
resultsTab.addEventListener("click", () => activateTab("results"));
textTab.addEventListener("keydown", handleTabKeydown);
resultsTab.addEventListener("keydown", handleTabKeydown);

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    compareTexts();
  }
});

syncScroll(diffA, diffB);
syncScroll(diffB, diffA);
updateCounts();
