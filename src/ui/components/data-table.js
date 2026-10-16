/**
 * `DataTable`: HTML table with optional caption, row mapper, clickable sortable headers and
 * optional client-side pagination; used by the club analyzer view and the SBC rating calculator.
 *
 * Invariants:
 * - `options` is required (`headers`; optional `data`, `mapper`, `sortFunc`, `pageSize` = 20,
 *   `enablePagination`, `defaultSortDirection`, `id`, `className`, `caption`). Rows are arrays
 *   (after `mapper`); `HTMLElement` cells are appended, other values become text.
 * - A sortable header calls `options.sortFunc(currentData, data-sortby, data-sortby-direction)`
 *   BEFORE flipping `data-sortby-direction`; it may return an array or a Promise of one, and a
 *   falsy result keeps the rows. Sort key is `header.sort.key` or the header text; `data-sorted`
 *   and the `.sort-icon` classes mark the active column.
 * - With pagination, `id`/`className` go on a wrapper div that `getRootElement()` creates anew on
 *   every call (moving the table into it); without it they are on the `<table>`.
 * - `updateData()` without arguments re-renders the current data.
 *
 * Known issues (kept as-is):
 * - The page index is never reset or clamped when the data changes, so shorter data can render
 *   an empty page.
 * - The pagination labels ("Prev", "Next", "Page x of y") are hard-coded English.
 */
import { createElement } from "../../core/dom.js";

export class DataTable {
  #B;
  #M;
  #N;
  #L;
  #D;
  #R;
  #O;
  #U = false;
  #V;
  #F = "asc";
  constructor(options) {
    this.#V = options || {};
    this.#M = options.mapper;
    this.#U = options.enablePagination || false;
    this.#L = options.pageSize || 20;
    this.#D = 1;
    this.#F = options.defaultSortDirection || "asc";
    if (this.#U) {
      this.#B = createElement("table");
    } else {
      this.#B = createElement("table", {
        id: options.id,
        className: options.className,
      });
    }
    if (options.caption) {
      this.#B.createCaption().textContent = options.caption;
    }
    const headerRow = this.#B.createTHead().insertRow();
    const headerCells = [];
    for (let header of options.headers) {
      let headerCell = createElement("th");
      if (typeof header === "string") {
        headerCell.appendChild(document.createTextNode(header));
      } else {
        headerCell.appendChild(document.createTextNode(header.text));
        if (header.sort) {
          headerCell.addEventListener("click", (event) => {
            const sortResult = options.sortFunc(
              this.#N,
              headerCell.dataset.sortby,
              headerCell.dataset.sortbyDirection,
            );
            if (sortResult && sortResult.then) {
              sortResult.then((sortedData) => {
                if (sortedData) {
                  this.updateData(sortedData);
                }
              });
            } else if (sortResult) {
              this.updateData(sortResult);
            }
            headerCells.forEach((otherHeaderCell) => {
              otherHeaderCell.removeAttribute("data-sorted");
              const otherSortIcon = otherHeaderCell.querySelector(".sort-icon");
              if (otherSortIcon) {
                otherSortIcon.className = "sort-icon";
              }
            });
            const sortIcon = headerCell.querySelector(".sort-icon");
            sortIcon.className = "sort-icon fut_icon icon_arrow";
            if (headerCell.dataset.sortbyDirection === "asc") {
              sortIcon.className += " icon_arrow_up";
            }
            headerCell.setAttribute("data-sorted", headerCell.dataset.sortbyDirection);
            headerCell.setAttribute(
              "data-sortby-direction",
              headerCell.dataset.sortbyDirection === "asc" ? "desc" : "asc",
            );
          });
          const sortKey = (typeof header.sort === "object" && header.sort.key) || header.text;
          const sortDirection =
            typeof header.sort === "object" ? header.sort.direction || "asc" : this.#F;
          const isDefaultSort = typeof header.sort === "object" && header.sort.default;
          headerCell.setAttribute("data-sortby", sortKey);
          headerCell.setAttribute("data-sortby-direction", sortDirection);
          if (isDefaultSort) {
            const defaultSortIcon = createElement("span", {
              className: "sort-icon fut_icon icon_arrow",
            });
            if (sortDirection === "asc") {
              defaultSortIcon.className += " icon_arrow_up";
            }
            headerCell.setAttribute("data-sorted", true);
            headerCell.appendChild(defaultSortIcon);
          } else {
            headerCell.appendChild(
              createElement("span", {
                className: "sort-icon",
              }),
            );
          }
        }
      }
      headerRow.appendChild(headerCell);
      headerCells.push(headerCell);
    }
    if (this.#U) {
      this.#O = createElement("div", {
        className: "table-pagination",
      });
    }
    if (options.data) {
      this.updateData(options.data);
    }
  }
  #z(rows) {
    const tBody = this.#B.createTBody();
    for (let row of rows) {
      let tableRow = tBody.insertRow();
      if (this.#M) {
        row = this.#M(row);
      }
      for (let cellValue of row) {
        let cell = createElement("td");
        if (cellValue instanceof HTMLElement) {
          cell.appendChild(cellValue);
        } else {
          cell.appendChild(document.createTextNode(cellValue));
        }
        tableRow.appendChild(cell);
      }
    }
  }
  #j() {
    this.#O.innerHTML = "";
    if (this.#R <= 1) {
      return;
    }
    const prevButton = createElement("button", {
      className: "btn-prev",
    });
    prevButton.textContent = "← Prev";
    prevButton.disabled = this.#D === 1;
    prevButton.addEventListener("click", () => this.#q());
    const nextButton = createElement("button", {
      className: "btn-next",
    });
    nextButton.textContent = "Next →";
    nextButton.disabled = this.#D === this.#R;
    nextButton.addEventListener("click", () => this.#G());
    const pageInfo = createElement("span", {
      className: "page-info",
    });
    pageInfo.textContent = "Page " + this.#D + " of " + this.#R;
    this.#O.append(prevButton, pageInfo, nextButton);
  }
  #G() {
    if (this.#D < this.#R) {
      this.#D++;
      this.updateData();
    }
  }
  #q() {
    if (this.#D > 1) {
      this.#D--;
      this.updateData();
    }
  }
  ["updateData"](data) {
    this.#N = data || this.#N;
    if (this.#B.tBodies.length === 1) {
      this.#B.removeChild(this.#B.tBodies[0]);
    }
    if (this.#U) {
      this.#R = Math.ceil(this.#N.length / this.#L);
      const pageStart = (this.#D - 1) * this.#L;
      const pageEnd = pageStart + this.#L;
      const pageRows = this.#N.slice(pageStart, pageEnd);
      this.#z(pageRows);
      this.#j();
    } else {
      this.#z(this.#N);
    }
  }
  ["getRootElement"]() {
    if (this.#U) {
      const wrapper = createElement("div", {
        id: this.#V.id,
        className: this.#V.className,
      });
      wrapper.append(this.#B, this.#O);
      return wrapper;
    }
    return this.#B;
  }
}
