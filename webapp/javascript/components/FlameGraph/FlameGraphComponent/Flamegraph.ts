import { createFF } from '@utils/flamebearer';
import { Units, ratioToPercent, formatPercent } from '@utils/format';
import { RenderCanvas } from './CanvasRenderer';
import { PX_PER_LEVEL, BAR_HEIGHT, COLLAPSE_THRESHOLD } from './constants';
import { getRatios } from './utils';

/* eslint-disable no-useless-constructor */

// if it's type double (diff), we also require `left` and `right` ticks
type addTicks =
  | { format: 'double'; leftTicks: number; rightTicks: number }
  | { format: 'single' };

type Flamebearer = {
  names: string[];
  levels: number[][];
  numTicks: number;
  sampleRate: number;
  units: Units;
  spyName: string;
} & addTicks;

export default class Flamegraph {
  private ff: ReturnType<typeof createFF>;

  constructor(
    private readonly flamebearer: Flamebearer,
    private canvas: HTMLCanvasElement,
    private topLevel: number,
    private rangeMin: number,
    private rangeMax: number,
    private selectedLevel: number,
    private fitMode: 'HEAD' | 'TAIL',
    private highlightQuery: string
  ) {
    this.ff = createFF(flamebearer.format);
  }

  render() {
    const props = {
      canvas: this.canvas,

      viewType: this.flamebearer.format,
      numTicks: this.flamebearer.numTicks,
      sampleRate: this.flamebearer.sampleRate,
      names: this.flamebearer.names,
      levels: this.flamebearer.levels,
      spyName: this.flamebearer.spyName,
      units: this.flamebearer.units,

      topLevel: this.topLevel,
      rangeMin: this.rangeMin,
      rangeMax: this.rangeMax,
      fitMode: this.fitMode,
      selectedLevel: this.selectedLevel,
      highlightQuery: this.highlightQuery,
    };

    const { format: viewType } = this.flamebearer;

    switch (viewType) {
      case 'single': {
        RenderCanvas({ ...props, viewType: 'single' });
        break;
      }
      case 'double': {
        RenderCanvas({
          ...props,
          leftTicks: this.flamebearer.leftTicks,
          rightTicks: this.flamebearer.rightTicks,
        });
        break;
      }
      default: {
        throw new Error(`Invalid format: '${viewType}'`);
      }
    }
  }

  private pxPerTick() {
    const graphWidth = this.canvas.width;

    return (
      graphWidth / this.flamebearer.numTicks / (this.rangeMax - this.rangeMin)
    );
  }

  private tickToX(i: number) {
    return (i - this.flamebearer.numTicks * this.rangeMin) * this.pxPerTick();
  }

  private getCanvasWidth() {
    // bit of a hack, but clientWidth is not available in node-canvas
    return this.canvas.clientWidth || this.canvas.width;
  }

  private isFocused() {
    return this.topLevel > 0;
  }

  // binary search of a block in a stack level
  // TODO(eh-am): calculations seem wrong when x is 0 and y != 0,
  // also when on the border
  private binarySearchLevel(x: number, level: number[]) {
    const { ff } = this;

    let i = 0;
    let j = level.length - ff.jStep;

    while (i <= j) {
      /* eslint-disable-next-line no-bitwise */
      const m = ff.jStep * ((i / ff.jStep + j / ff.jStep) >> 1);
      const x0 = this.tickToX(ff.getBarOffset(level, m));
      const x1 = this.tickToX(
        ff.getBarOffset(level, m) + ff.getBarTotal(level, m)
      );

      if (x0 <= x && x1 >= x) {
        return x1 - x0 > COLLAPSE_THRESHOLD ? m : -1;
      }
      if (x0 > x) {
        j = m - ff.jStep;
      } else {
        i = m + ff.jStep;
      }
    }
    return -1;
  }

  xyToBar(x: number, y: number) {
    if (x < 0 || y < 0) {
      throw new Error(`x and y must be bigger than 0. x = ${x}, y = ${y}`);
    }

    // in focused mode there's a "fake" bar at the top
    // so we must discount for it
    const computedY = this.isFocused() ? y - BAR_HEIGHT : y;

    const i = Math.floor(computedY / PX_PER_LEVEL) + this.topLevel;

    if (i >= 0 && i < this.flamebearer.levels.length) {
      const j = this.binarySearchLevel(x, this.flamebearer.levels[i]);

      return { i, j };
    }

    return { i: 0, j: 0 };
  }

  // TODO: should this be exposed?
  getCanvas() {
    return this.canvas;
  }

  isWithinBounds = (x: number, y: number) => {
    if (x < 0 || x > this.getCanvasWidth()) {
      return false;
    }

    try {
      const { i, j } = this.xyToBar(x, y);
      if (j === -1 || i === -1) {
        return false;
      }
    } catch (e) {
      return false;
    }

    return true;
  };

  /*
   * Given x and y coordinates
   * identify the bar position and width
   *
   * This can be used for highlighting
   */
  xyToBarPosition = (x: number, y: number) => {
    if (!this.isWithinBounds(x, y)) {
      throw new Error(`Value out of bounds. Can't get bar position`);
    }

    const { ff } = this;
    const { i, j } = this.xyToBar(x, y);

    const level = this.flamebearer.levels[i];

    const posX = Math.max(this.tickToX(ff.getBarOffset(level, j)), 0);
    const posY =
      (i - this.topLevel) * PX_PER_LEVEL + (this.isFocused() ? BAR_HEIGHT : 0);

    const sw = Math.min(
      this.tickToX(ff.getBarOffset(level, j) + ff.getBarTotal(level, j)) - posX,
      this.getCanvasWidth()
    );

    return {
      x: posX,
      y: posY,
      width: sw,
    };
  };

  // TODO rename this
  // this should be only interface
  xyToBarData(x: number, y: number) {
    if (!this.isWithinBounds(x, y)) {
      throw new Error(
        `Value out of bounds. Can't get bar position. x: '${x}', y: '${y}'`
      );
    }

    const { i, j } = this.xyToBar(x, y);
    const level = this.flamebearer.levels[i];

    const { ff } = this;

    switch (this.flamebearer.format) {
      case 'single': {
        return {
          format: 'single',
          name: this.flamebearer.names[ff.getBarName(level, j)],
          self: ff.getBarSelf(level, j),
          offset: ff.getBarOffset(level, j),
          total: ff.getBarTotal(level, j),
        };
      }
      case 'double': {
        return {
          format: 'double',
          barTotal: ff.getBarTotal(level, j),
          totalLeft: ff.getBarTotalLeft(level, j),
          totalRight: ff.getBarTotalRght(level, j),
          totalDiff: ff.getBarTotalDiff(level, j),
          name: this.flamebearer.names[ff.getBarName(level, j)],
        };
      }

      default: {
        throw new Error(`Unsupported type`);
      }
    }
  }

  xyToZoom(x: number, y: number) {
    const { i, j } = this.xyToBar(x, y);
    // TODO what if
    //    if (j === -1) return;
    const { ff } = this;

    return {
      selectedLevel: i,
      //  topLevel: 0,
      rangeMin:
        ff.getBarOffset(this.flamebearer.levels[i], j) /
        this.flamebearer.numTicks,
      rangeMax:
        (ff.getBarOffset(this.flamebearer.levels[i], j) +
          ff.getBarTotal(this.flamebearer.levels[i], j)) /
        this.flamebearer.numTicks,
    };
  }

  setFitMode(fitMode: 'HEAD' | 'TAIL') {
    this.fitMode = fitMode;
  }

  setHighlightQuery(query: string) {
    this.highlightQuery = query;
  }

  setRangeMin(n: number) {
    this.rangeMin = n;
  }

  setRangeMax(n: number) {
    this.rangeMax = n;
  }

  setSelectedLevel(n: number) {
    this.selectedLevel = n;
  }

  isZoomed() {
    return this.rangeMin > 0 && this.rangeMax < 1;
  }

  isPristine() {
    // TODO there are more conditions here
    return this.rangeMin === 0 && this.rangeMax === 1;
  }
}
