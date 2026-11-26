/* Presentation-only camera for the current native Robo scene.
 * Source: ScreenManager.setStageData; ScrollDefine; ScrollManagerBase
 * updateScrollPos/updateScrollRectSize; MapDataModel.setMapBeginPos/reset.
 * See evidence/robo_scene_audit/ROBO_SCENE_AUDIT.md in the M7 workspace.
 * No combat, movement, collision or server state is changed here.
 */

const MIN_VIEW_WIDTH = 1000;
const MIN_VIEW_HEIGHT = 600;
const FREE_WIDTH = 200;
const FREE_HEIGHT = 50;
const ZOOM_FACTOR = Object.freeze({far: 0.80, mid: 1, near: 1.24});

// AS3 int parameters/locals truncate toward zero and convert to signed int32.
const int32 = value => Number(value) | 0;

function followAxis(begin, position, viewSize, mapSize, freeSize) {
  // Keep the original relative distance for both comparisons, as AS3 does.
  // In particular, do not center the actor or clamp begin before this step.
  const distance = int32(position - begin);
  const upper = int32((viewSize + freeSize) / 2);
  const lower = int32((viewSize - freeSize) / 2);
  if (distance > upper) {
    begin = int32(begin + distance - upper);
    if (begin > mapSize - viewSize) begin = int32(mapSize - viewSize);
  }
  if (distance < lower) {
    begin = int32(begin - (lower - distance));
    if (begin < 0) begin = 0;
  }
  // MapDataModel.updateScrollParams floors the maximum origin at zero;
  // setMapBeginPos then clips the result to the map's full bitmap bounds.
  return Math.max(0, Math.min(begin, Math.max(0, mapSize - viewSize)));
}

export class RoboCamera {
  constructor({stageWidth = MIN_VIEW_WIDTH, stageHeight = MIN_VIEW_HEIGHT,
    mapWidth = 2400, mapHeight = 2400, centerSmallMap = false} = {}) {
    this.beginX = 0;
    this.beginY = 0;
    this.followedX = 0;
    this.followedY = 0;
    this.resize(stageWidth, stageHeight, mapWidth, mapHeight, {centerSmallMap});
  }

  // Call for a new scene, then follow the actual native self position. A
  // respawn within the same scene retains camera history in the Flash client.
  reset() {
    this.beginX = 0;
    this.beginY = 0;
    this.followedX = 0;
    this.followedY = 0;
    return this.snapshot();
  }

  resize(stageWidth, stageHeight, mapWidth = this.mapWidth, mapHeight = this.mapHeight,
    {centerSmallMap = false, fitMinView = false, zoomMode = 'mid'} = {}) {
    this.stageWidth = int32(stageWidth);
    this.stageHeight = int32(stageHeight);
    this.mapWidth = int32(mapWidth);
    this.mapHeight = int32(mapHeight);
    this.fitMinView = !!fitMinView;
    const shrink = fitMinView && (this.stageWidth < MIN_VIEW_WIDTH || this.stageHeight < MIN_VIEW_HEIGHT);
    if (shrink) {
      const baseZoom = Math.max(0.48, Math.min(0.88, Number(stageWidth) / 880, Number(stageHeight) / 540));
      const factor = ZOOM_FACTOR[zoomMode] ?? 1;
      this.zoom = Math.max(0.42, Math.min(1, baseZoom * factor));
    } else {
      this.zoom = 1;
    }
    this.viewWidth = shrink
      ? Math.max(1, int32(Math.round(Number(stageWidth) / this.zoom)))
      : Math.max(MIN_VIEW_WIDTH, this.stageWidth);
    this.viewHeight = shrink
      ? Math.max(1, int32(Math.round(Number(stageHeight) / this.zoom)))
      : Math.max(MIN_VIEW_HEIGHT, this.stageHeight);
    // Keep small PvE scenes at their native scale instead of enlarging them
    // to fill a large window. Center only axes whose entire map fits: a tall
    // or wide scene must still scroll normally on its other axis. Restrict
    // the logical view to the map on centered axes so the minimap and native
    // visibility checks describe actual world area, not the empty margins.
    // PvP keeps the original AS3 viewport/dead-zone path and integer casts.
    this.stageOffsetX = 0;
    this.stageOffsetY = 0;
    if (centerSmallMap && this.mapWidth > 0 && Number(stageWidth) / this.zoom >= this.mapWidth) {
      this.viewWidth = this.mapWidth;
      this.stageOffsetX = (Number(stageWidth) / this.zoom - this.mapWidth) / 2;
    }
    if (centerSmallMap && this.mapHeight > 0 && Number(stageHeight) / this.zoom >= this.mapHeight) {
      this.viewHeight = this.mapHeight;
      this.stageOffsetY = (Number(stageHeight) / this.zoom - this.mapHeight) / 2;
    }
    // Flash preserves scrollRect.x/y on resize and re-evaluates its last
    // followed position after installing the new viewport and map bounds.
    return this.follow(this.followedX, this.followedY);
  }

  follow(worldX, worldY) {
    this.followedX = int32(worldX);
    this.followedY = int32(worldY);
    const freeW = this.fitMinView ? 48 : FREE_WIDTH;
    const freeH = this.fitMinView ? 28 : FREE_HEIGHT;
    this.beginX = followAxis(this.beginX, this.followedX,
      this.viewWidth, this.mapWidth, freeW);
    this.beginY = followAxis(this.beginY, this.followedY,
      this.viewHeight, this.mapHeight, freeH);
    return this.snapshot();
  }

  snapshot() {
    return {
      beginX: this.beginX,
      beginY: this.beginY,
      viewWidth: this.viewWidth,
      viewHeight: this.viewHeight,
      zoom: this.zoom,
      centerX: this.beginX + this.viewWidth / 2,
      centerY: this.beginY + this.viewHeight / 2,
      // Positive offsets are presentation-only margins around a small PvE
      // map. The camera center already includes this placement; all drawing
      // and screen/world input use the same transform, with no second shift.
      // Smaller windows retain the native minimum logical viewport/clipping.
      stageOffsetX: this.stageOffsetX,
      stageOffsetY: this.stageOffsetY,
      stageWidth: this.stageWidth,
      stageHeight: this.stageHeight,
      mapWidth: this.mapWidth,
      mapHeight: this.mapHeight,
      followedX: this.followedX,
      followedY: this.followedY,
    };
  }
}
