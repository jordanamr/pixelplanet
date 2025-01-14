/*
 * Renders 2D canvases
 *
 * @flow
 */

import type { Cell } from '../core/Cell';
import type { State } from '../reducers';
import { TILE_ZOOM_LEVEL, TILE_SIZE } from '../core/constants';

import {
  getTileOfPixel,
  getPixelFromChunkOffset,
  getMaxTiledZoom,
} from '../core/utils';

import {
  renderGrid,
  renderPlaceholder,
  renderPotatoPlaceholder,
} from './render2Delements';
import PixelPainterControls from '../controls/PixelPainterControls';


import ChunkLoader from './ChunkLoader2D';
import pixelNotify from './PixelNotify';

// dimensions of offscreen canvas NOT whole canvas
// eslint-disable-next-line max-len
const CANVAS_WIDTH = 2 * Math.ceil(window.screen.width / 2) + TILE_ZOOM_LEVEL * TILE_SIZE;
// eslint-disable-next-line max-len
const CANVAS_HEIGHT = 2 * Math.ceil(window.screen.height / 2) + TILE_ZOOM_LEVEL * TILE_SIZE;
const SCALE_THREASHOLD = Math.min(
  CANVAS_WIDTH / TILE_SIZE / 3,
  CANVAS_HEIGHT / TILE_SIZE / 3,
);


class Renderer {
  is3D: false;
  //
  canvasId: number = null;
  chunkLoader: Object = null;
  //--
  centerChunk: Cell;
  tiledScale: number;
  tiledZoom: number;
  hover: boolean;
  //--
  viewport: HTMLCanvasElement = null;
  store;
  //--
  forceNextRender: boolean;
  forceNextSubrender: boolean;
  canvas: HTMLCanvasElement;
  lastFetch: number;
  //--
  oldHistoricalTime: string;

  constructor(store) {
    this.centerChunk = [null, null];
    this.tiledScale = 0;
    this.tiledZoom = 4;
    this.canvasMaxTiledZoom = 0;
    this.historicalCanvasMaxTiledZoom = 0;
    this.hover = false;
    //--
    this.forceNextRender = true;
    this.forceNextSubrender = true;
    this.lastFetch = 0;
    this.oldHistoricalTime = null;
    //--
    const viewport = document.createElement('canvas');
    viewport.width = window.innerWidth;
    viewport.height = window.innerHeight;
    viewport.className = 'viewport';
    this.viewport = viewport;
    document.body.appendChild(this.viewport);
    //--
    this.resizeHandle = this.resizeHandle.bind(this);
    window.addEventListener('resize', this.resizeHandle);
    //--
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_WIDTH;
    this.canvas.height = CANVAS_HEIGHT;

    const context = this.canvas.getContext('2d');
    context.fillStyle = '#000000';
    context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    //--
    this.setStore(store);
  }

  destructor() {
    this.controls.dispose();
    window.removeEventListener('resize', this.resizeHandle);
    this.viewport.remove();
  }

  getViewport() {
    return this.viewport;
  }

  getAllChunks() {
    return this.chunkLoader.getAllChunks();
  }

  resizeHandle() {
    this.viewport.width = window.innerWidth;
    this.viewport.height = window.innerHeight;
    this.forceNextRender = true;
  }

  // HAS to be set before any rendering can happen
  setStore(store) {
    this.store = store;
    const state = store.getState();
    this.updateCanvasData(state);
    this.updateScale(state);
    this.controls = new PixelPainterControls(this, this.viewport, store);
  }

  updateCanvasData(state: State) {
    const {
      canvasId,
    } = state.canvas;
    if (canvasId !== this.canvasId) {
      this.canvasId = canvasId;
      if (canvasId !== null) {
        const {
          palette,
          canvasSize,
          canvases,
        } = state.canvas;
        this.canvasMaxTiledZoom = getMaxTiledZoom(canvasSize);
        this.historicalCanvasMaxTiledZoom = this.canvasMaxTiledZoom;
        this.chunkLoader = new ChunkLoader(
          this.store,
          canvasId,
          palette,
          canvasSize,
          canvases[canvasId].historicalSizes,
        );
      }
    }
    this.updateScale(state);
  }

  updateOldHistoricalTime(oldDate, oldTime) {
    if (oldTime === '0000') {
      this.oldHistoricalTime = null;
    } else {
      this.oldHistoricalTime = oldTime;
    }
  }

  updateHistoricalTime(historicalDate, historicalTime, historicalCanvasSize) {
    this.historicalCanvasMaxTiledZoom = getMaxTiledZoom(
      historicalCanvasSize,
    );
    this.forceNextRender = true;
    this.updateScale(this.store.getState());
  }

  getColorIndexOfPixel(cx, cy, historical: boolean = false) {
    if (historical) {
      const state = this.store.getState();
      const {
        historicalDate,
        historicalTime,
        historicalCanvasSize,
      } = state.canvas;
      return this.chunkLoader.getHistoricalIndexOfPixel(cx, cy,
        historicalDate, historicalTime, historicalCanvasSize);
    }
    return this.chunkLoader.getColorIndexOfPixel(cx, cy);
  }

  updateScale(
    state,
    prevScale = null,
  ) {
    const {
      viewscale,
      isHistoricalView,
    } = state.canvas;
    pixelNotify.updateScale(viewscale);
    let tiledScale = (viewscale > 0.5)
      ? 0
      : Math.round(Math.log2(viewscale) * 2 / TILE_ZOOM_LEVEL);
    tiledScale = TILE_ZOOM_LEVEL ** tiledScale;
    const canvasMaxTiledZoom = (isHistoricalView)
      ? this.historicalCanvasMaxTiledZoom
      : this.canvasMaxTiledZoom;
    const tiledZoom = canvasMaxTiledZoom + Math.log2(tiledScale)
      * 2 / TILE_ZOOM_LEVEL;
    const relScale = viewscale / tiledScale;

    this.tiledScale = tiledScale;
    this.tiledZoom = tiledZoom;
    this.relScale = relScale;
    this.updateView(state);
    if (prevScale === null
      || viewscale < SCALE_THREASHOLD || prevScale < SCALE_THREASHOLD) {
      this.forceNextRender = true;
    } else {
      this.forceNextSubrender = true;
    }
  }

  updateView(state) {
    const {
      view,
    } = state.canvas;
    const canvasSize = (state.canvas.isHistoricalView)
      ? state.canvas.historicalCanvasSize
      : state.canvas.canvasSize;

    const [x, y] = view;
    let [cx, cy] = this.centerChunk;
    const [curcx, curcy] = getTileOfPixel(
      this.tiledScale,
      [x, y],
      canvasSize,
    );
    if (cx !== curcx || cy !== curcy) {
      cx = curcx;
      cy = curcy;
      this.centerChunk = [cx, cy];
      this.forceNextRender = true;
    } else {
      this.forceNextSubrender = true;
    }
  }


  renderPixel(
    i: number,
    j: number,
    offset: number,
    color: ColorIndex,
  ) {
    const state: State = this.store.getState();
    const {
      canvasSize,
      palette,
      scale,
      isHistoricalView,
    } = state.canvas;
    this.chunkLoader.getPixelUpdate(i, j, offset, color);

    if (scale < 0.8 || isHistoricalView) return;
    const scaleM = (scale > SCALE_THREASHOLD) ? 1 : scale;

    const context = this.canvas.getContext('2d');
    if (!context) return;

    const [x, y] = getPixelFromChunkOffset(i, j, offset, canvasSize);

    const [canX, canY] = this.centerChunk
      .map((z) => (z + 0.5) * TILE_SIZE - canvasSize / 2);
    const px = ((x - canX) * scaleM) + (CANVAS_WIDTH / 2);
    const py = ((y - canY) * scaleM) + (CANVAS_HEIGHT / 2);
    // if not part of our current canvas, do not render
    if (px < 0 || px >= CANVAS_WIDTH || py < 0 || py >= CANVAS_HEIGHT) return;

    context.fillStyle = palette.colors[color];
    context.fillRect(px, py, scaleM, scaleM);
    pixelNotify.addPixel(x, y);

    this.forceNextSubrender = true;
  }


  isChunkInView(
    cz: number,
    cx: number,
    cy: number,
  ) {
    if (cz !== this.tiledZoom) {
      return false;
    }
    const { width, height } = this.viewport;
    const CHUNK_RENDER_RADIUS_X = Math.ceil(
      width / TILE_SIZE / 2 / this.relScale,
    );
    const CHUNK_RENDER_RADIUS_Y = Math.ceil(
      height / TILE_SIZE / 2 / this.relScale,
    );
    const [xc, yc] = this.centerChunk;
    if (Math.abs(cx - xc)
      <= CHUNK_RENDER_RADIUS_X && Math.abs(cy - yc)
      <= CHUNK_RENDER_RADIUS_Y
    ) {
      return true;
    }
    return false;
  }


  renderChunks(
    state: State,
  ) {
    const context = this.canvas.getContext('2d');
    if (!context) return;

    const {
      centerChunk: chunkPosition,
      tiledScale,
      tiledZoom,
      viewport,
    } = this;
    const {
      viewscale: scale,
      canvasSize,
    } = state.canvas;

    let { relScale } = this;

    // Disable smoothing
    // making it dependent on the scale is needed for Google Chrome, else
    // scale <1 would look shit
    if (scale >= 1) {
      context.msImageSmoothingEnabled = false;
      context.webkitImageSmoothingEnabled = false;
      context.imageSmoothingEnabled = false;
    } else {
      context.msImageSmoothingEnabled = true;
      context.webkitImageSmoothingEnabled = true;
      context.imageSmoothingEnabled = true;
    }
    // define how many chunks we will render
    // don't render chunks outside of viewport
    const { width, height } = viewport;
    const CHUNK_RENDER_RADIUS_X = Math.ceil(width / TILE_SIZE / 2 / relScale);
    const CHUNK_RENDER_RADIUS_Y = Math.ceil(height / TILE_SIZE / 2 / relScale);
    // If scale is so large that neighbouring chunks wouldn't fit in canvas,
    // do scale = 1 and scale in render()
    if (scale > SCALE_THREASHOLD) relScale = 1.0;
    // scale
    context.save();
    context.fillStyle = '#C4C4C4';
    context.scale(relScale, relScale);
    // decide if we will fetch missing chunks
    // and update the timestamps of accessed chunks
    const curTime = Date.now();
    let fetch = false;
    if (curTime > this.lastFetch + 150) {
      this.lastFetch = curTime;
      fetch = true;
    }

    const xOffset = CANVAS_WIDTH / 2 / relScale - TILE_SIZE / 2;
    const yOffset = CANVAS_HEIGHT / 2 / relScale - TILE_SIZE / 2;

    const [xc, yc] = chunkPosition; // center chunk
    // CLEAN margin
    // draw new chunks. If not existing, just clear.
    let chunk;
    for (
      let dx = -CHUNK_RENDER_RADIUS_X;
      dx <= CHUNK_RENDER_RADIUS_X;
      dx += 1
    ) {
      for (
        let dy = -CHUNK_RENDER_RADIUS_Y;
        dy <= CHUNK_RENDER_RADIUS_Y;
        dy += 1
      ) {
        const cx = xc + dx;
        const cy = yc + dy;
        const x = xOffset + dx * TILE_SIZE;
        const y = yOffset + dy * TILE_SIZE;

        const chunkMaxXY = canvasSize / TILE_SIZE;
        if (
          cx < 0 || cx >= chunkMaxXY * tiledScale
          || cy < 0 || cy >= chunkMaxXY * tiledScale
        ) {
          // if out of bounds
          context.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        } else {
          chunk = this.chunkLoader.getChunk(tiledZoom, cx, cy, fetch);
          if (chunk) {
            context.drawImage(chunk, x, y);
            if (fetch) {
              chunk.timestamp = curTime;
            }
          } else {
            context.fillRect(x, y, TILE_SIZE, TILE_SIZE);
          }
        }
      }
    }
    context.restore();
  }


  render() {
    if (!this.chunkLoader) {
      return;
    }
    const state: State = this.store.getState();
    if (state.canvas.isHistoricalView) {
      this.renderHistorical(state);
    } else {
      this.renderMain(state);
    }
  }


  // keep in mind that everything we got here gets executed 60 times per second
  // avoiding unneccessary stuff is important
  renderMain(
    state: State,
  ) {
    const {
      viewport,
    } = this;
    const {
      showGrid,
      showPixelNotify,
      hover,
      isPotato,
      isLightGrid,
    } = state.gui;
    const {
      requestingPixel,
    } = state.user;
    const {
      view,
      viewscale,
      canvasSize,
    } = state.canvas;

    const [x, y] = view;
    const [cx, cy] = this.centerChunk;

    // if we have to render pixelnotify
    const doRenderPixelnotify = (
      viewscale >= 0.5
      && showPixelNotify
      && pixelNotify.doRender()
    );
    // if we have to render placeholder
    const doRenderPlaceholder = (
      viewscale >= 3
      && requestingPixel
      && (hover || this.hover)
      && !isPotato
    );
    const doRenderPotatoPlaceholder = (
      viewscale >= 3
      && requestingPixel
      && (hover !== this.hover
        || this.forceNextRender
        || this.forceNextSubrender
        || doRenderPixelnotify
      ) && isPotato
    );
    //--
    // if we have nothing to render, return
    // note: this.hover is used to, to render without the placeholder one last
    // time when cursor leaves window
    if (
      // no full rerender
      !this.forceNextRender
      // no render placeholder under cursor
      && !doRenderPlaceholder
      && !doRenderPotatoPlaceholder
      // no pixelnotification
      && !doRenderPixelnotify
      // no forced just-viewscale render (i.e. when just a pixel got set)
      && !this.forceNextSubrender
    ) {
      return;
    }
    this.hover = hover;

    if (this.forceNextRender) {
      this.renderChunks(state);
    }
    this.forceNextRender = false;
    this.forceNextSubrender = false;

    const { width, height } = viewport;
    const viewportCtx = viewport.getContext('2d');
    if (!viewportCtx) return;

    // canvasopt: https://www.html5rocks.com/en/tutorials/canvas/performance/
    viewportCtx.msImageSmoothingEnabled = false;
    viewportCtx.webkitImageSmoothingEnabled = false;
    viewportCtx.imageSmoothingEnabled = false;
    // If scale is so large that neighbouring chunks wouldn't fit in offscreen
    // canvas, do scale = 1 in renderChunks and scale in render()
    const canvasCenter = canvasSize / 2;
    if (viewscale > SCALE_THREASHOLD) {
      viewportCtx.save();
      viewportCtx.scale(viewscale, viewscale);
      viewportCtx.drawImage(
        this.canvas,
        width / 2 / viewscale - CANVAS_WIDTH / 2 + (
          (cx + 0.5) * TILE_SIZE - canvasCenter - x),
        height / 2 / viewscale - CANVAS_HEIGHT / 2 + (
          (cy + 0.5) * TILE_SIZE - canvasCenter - y),
      );
      viewportCtx.restore();
    } else {
      viewportCtx.drawImage(
        this.canvas,
        Math.floor(width / 2 - CANVAS_WIDTH / 2
          + ((cx + 0.5) * TILE_SIZE / this.tiledScale
          - canvasCenter - x) * viewscale),
        Math.floor(height / 2 - CANVAS_HEIGHT / 2
          + ((cy + 0.5) * TILE_SIZE / this.tiledScale
          - canvasCenter - y) * viewscale),
      );
    }

    if (showGrid && viewscale >= 8) {
      renderGrid(state, viewport, viewscale, isLightGrid);
    }

    if (doRenderPixelnotify) pixelNotify.render(state, viewport);

    if (hover && doRenderPlaceholder) {
      renderPlaceholder(state, viewport, viewscale);
    }
    if (hover && doRenderPotatoPlaceholder) {
      renderPotatoPlaceholder(state, viewport, viewscale);
    }
  }


  renderHistoricalChunks(
    state: State,
  ) {
    const context = this.canvas.getContext('2d');
    if (!context) return;

    const {
      centerChunk: chunkPosition,
      viewport,
      oldHistoricalTime,
    } = this;
    const {
      viewscale,
      historicalDate,
      historicalTime,
      historicalCanvasSize,
    } = state.canvas;

    // Disable smoothing
    // making it dependent on the scale is needed for Google Chrome, else
    // scale <1 would look shit
    if (viewscale >= 1) {
      context.msImageSmoothingEnabled = false;
      context.webkitImageSmoothingEnabled = false;
      context.imageSmoothingEnabled = false;
    } else {
      context.msImageSmoothingEnabled = true;
      context.webkitImageSmoothingEnabled = true;
      context.imageSmoothingEnabled = true;
    }

    const scale = (viewscale > SCALE_THREASHOLD) ? 1.0 : viewscale;
    // define how many chunks we will render
    // don't render chunks outside of viewport
    const { width, height } = viewport;
    const CHUNK_RENDER_RADIUS_X = Math.ceil(width / TILE_SIZE / 2 / scale);
    const CHUNK_RENDER_RADIUS_Y = Math.ceil(height / TILE_SIZE / 2 / scale);

    context.save();
    context.fillStyle = '#C4C4C4';
    // clear canvas and do nothing if no time selected
    if (!historicalDate || !historicalTime) {
      context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      context.restore();
      return;
    }
    // scale
    context.scale(scale, scale);
    // decide if we will fetch missing chunks
    // and update the timestamps of accessed chunks
    const curTime = Date.now();
    let fetch = false;
    if (curTime > this.lastFetch + 150) {
      this.lastFetch = curTime;
      fetch = true;
    }

    const xOffset = CANVAS_WIDTH / 2 / scale - TILE_SIZE / 2;
    const yOffset = CANVAS_HEIGHT / 2 / scale - TILE_SIZE / 2;

    const [xc, yc] = chunkPosition; // center chunk
    // CLEAN margin
    // draw  chunks. If not existing, just clear.
    let chunk;
    for (
      let dx = -CHUNK_RENDER_RADIUS_X;
      dx <= CHUNK_RENDER_RADIUS_X;
      dx += 1
    ) {
      for (
        let dy = -CHUNK_RENDER_RADIUS_Y;
        dy <= CHUNK_RENDER_RADIUS_Y;
        dy += 1
      ) {
        const cx = xc + dx;
        const cy = yc + dy;
        const x = xOffset + dx * TILE_SIZE;
        const y = yOffset + dy * TILE_SIZE;

        const chunkMaxXY = historicalCanvasSize / TILE_SIZE;
        if (cx < 0 || cx >= chunkMaxXY || cy < 0 || cy >= chunkMaxXY) {
          // if out of bounds
          context.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        } else {
          // full chunks
          chunk = this.chunkLoader
            .getHistoricalChunk(cx, cy, fetch, historicalDate);
          if (chunk) {
            context.drawImage(chunk, x, y);
            if (fetch) {
              chunk.timestamp = curTime;
            }
          } else {
            context.fillRect(x, y, TILE_SIZE, TILE_SIZE);
          }
          // incremential chunks
          if (historicalTime === '0000') continue;
          chunk = this.chunkLoader
            .getHistoricalChunk(cx, cy, fetch, historicalDate, historicalTime);
          if (chunk) {
            context.drawImage(chunk, x, y);
            if (fetch) {
              chunk.timestamp = curTime;
            }
          } else if (oldHistoricalTime) {
            chunk = this.chunkLoader
              .getHistoricalChunk(
                cx,
                cy,
                false,
                historicalDate,
                oldHistoricalTime,
              );
            if (chunk) {
              context.drawImage(chunk, x, y);
              if (fetch) {
                chunk.timestamp = curTime;
              }
            }
          }
        }
      }
    }
    context.restore();
  }


  // keep in mind that everything we got here gets executed 60 times per second
  // avoiding unneccessary stuff is important
  renderHistorical(
    state: State,
  ) {
    const {
      viewport,
    } = this;
    const {
      showGrid,
      isLightGrid,
    } = state.gui;
    const {
      view,
      viewscale,
      historicalCanvasSize,
    } = state.canvas;

    const [x, y] = view;
    const [cx, cy] = this.centerChunk;

    if (!this.forceNextRender && !this.forceNextSubrender) {
      return;
    }

    if (this.forceNextRender) {
      this.renderHistoricalChunks(state);
    }
    this.forceNextRender = false;
    this.forceNextSubrender = false;

    const { width, height } = viewport;
    const viewportCtx = viewport.getContext('2d');
    if (!viewportCtx) return;

    viewportCtx.msImageSmoothingEnabled = false;
    viewportCtx.webkitImageSmoothingEnabled = false;
    viewportCtx.imageSmoothingEnabled = false;
    // If scale is so large that neighbouring chunks wouldn't fit in offscreen
    // canvas, do scale = 1 in renderChunks and scale in render()
    const canvasCenter = historicalCanvasSize / 2;
    if (viewscale > SCALE_THREASHOLD) {
      viewportCtx.save();
      viewportCtx.scale(viewscale, viewscale);
      viewportCtx.drawImage(
        this.canvas,
        // eslint-disable-next-line max-len
        width / 2 / viewscale - CANVAS_WIDTH / 2 + ((cx + 0.5) * TILE_SIZE - canvasCenter - x),
        // eslint-disable-next-line max-len
        height / 2 / viewscale - CANVAS_HEIGHT / 2 + ((cy + 0.5) * TILE_SIZE - canvasCenter - y),
      );
      viewportCtx.restore();
    } else {
      viewportCtx.drawImage(
        this.canvas,
        // eslint-disable-next-line max-len
        Math.floor(width / 2 - CANVAS_WIDTH / 2 + ((cx + 0.5) * TILE_SIZE - canvasCenter - x) * viewscale),
        // eslint-disable-next-line max-len
        Math.floor(height / 2 - CANVAS_HEIGHT / 2 + ((cy + 0.5) * TILE_SIZE - canvasCenter - y) * viewscale),
      );
    }

    if (showGrid && viewscale >= 8) {
      renderGrid(state, viewport, viewscale, isLightGrid);
    }
  }
}


export default Renderer;
