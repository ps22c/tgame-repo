
import {
    GameObject,
    Vec2,
    Rect
} from "lib@engine";

// ============================================================
// TILEMAP - TGame Tilemap Plugin
// ============================================================

const clamp = (v, min, max) =>
    Math.max(min, Math.min(max, v));

function assertInteger(value, name) {
    if (!Number.isInteger(value) || value < 0)
        throw new RangeError(`${name} must be a non-negative integer`);
}

// ============================================================
// TILE
// ============================================================

export class Tile {
    constructor(id = 0, properties = {}) {
        this.id = id;
        this.properties = { ...properties };
    }

    get empty() {
        return this.id === 0;
    }

    get solid() {
        return !!this.properties.solid;
    }
}

// ============================================================
// TILESET
// ============================================================

export class Tileset {
    constructor(options = {}) {
        this.tileWidth = options.tileWidth ?? 16;
        this.tileHeight = options.tileHeight ?? 16;

        this.margin = options.margin ?? 0;
        this.spacing = options.spacing ?? 0;

        this.columns = options.columns ?? 0;
        this.rows = options.rows ?? 0;

        this.properties = new Map();

        this.loaded = false;
        this.error = null;

        this.image = null;

        this.onLoad = options.onLoad ?? null;
        this.onError = options.onError ?? null;

        if (this.tileWidth <= 0 || this.tileHeight <= 0)
            throw new RangeError("Invalid tileset tile size");

        if (options.image)
            this.setImage(options.image);
    }

    setImage(source) {
        if (typeof source === "string") {
            if (typeof Image === "undefined")
                throw new Error("Image is unavailable");

            const image = new Image();

            image.onload = () => {
                this.loaded = true;
                this._updateDimensions();
                this.onLoad?.(this);
            };

            image.onerror = error => {
                this.error = error;
                this.onError?.(error);
            };

            image.src = source;

            this.image = image;
        } else {
            this.image = source;

            if (source?.complete === false) {
                source.addEventListener?.("load", () => {
                    this.loaded = true;
                    this._updateDimensions();
                    this.onLoad?.(this);
                }, { once: true });

                source.addEventListener?.("error", error => {
                    this.error = error;
                    this.onError?.(error);
                }, { once: true });
            } else {
                this.loaded = !!source;
                this._updateDimensions();
            }
        }

        return this;
    }

    _updateDimensions() {
        if (!this.image)
            return;

        const width = this.image.naturalWidth || this.image.width;
        const height = this.image.naturalHeight || this.image.height;

        const strideX = this.tileWidth + this.spacing;
        const strideY = this.tileHeight + this.spacing;

        if (!this.columns && width > 0) {
            this.columns = Math.floor(
                (width - this.margin * 2 + this.spacing) / strideX
            );
        }

        if (!this.rows && height > 0) {
            this.rows = Math.floor(
                (height - this.margin * 2 + this.spacing) / strideY
            );
        }
    }

    get tileCount() {
        return this.columns * this.rows;
    }

    getSourceRect(id) {
        if (!Number.isInteger(id) || id <= 0)
            return null;

        if (!this.loaded || !this.image)
            return null;

        this._updateDimensions();

        const index = id - 1;

        if (index >= this.tileCount)
            return null;

        const column = index % this.columns;
        const row = Math.floor(index / this.columns);

        return new Rect(
            this.margin + column * (this.tileWidth + this.spacing),
            this.margin + row * (this.tileHeight + this.spacing),
            this.tileWidth,
            this.tileHeight
        );
    }

    setTileProperties(id, properties = {}) {
        assertInteger(id, "Tile ID");

        if (id === 0)
            throw new RangeError("Tile ID 0 is reserved for empty tiles");

        this.properties.set(id, { ...properties });

        return this;
    }

    getTileProperties(id) {
        return this.properties.get(id) || {};
    }

    drawTile(ctx, id, x, y, width, height) {
        const source = this.getSourceRect(id);

        if (!source)
            return false;

        ctx.drawImage(
            this.image,
            source.x,
            source.y,
            source.width,
            source.height,
            x,
            y,
            width,
            height
        );

        return true;
    }
}

// ============================================================
// TILEMAP LAYER
// ============================================================

export class TilemapLayer {
    constructor(name, map, options = {}) {
        this.name = name;
        this.map = map;

        this.width = map.width;
        this.height = map.height;

        this.data = new Uint32Array(
            this.width * this.height
        );

        this.visible = options.visible ?? true;
        this.opacity = clamp(options.opacity ?? 1, 0, 1);

        this.zIndex = options.zIndex ?? 0;

        this.properties = { ...options.properties };
    }

    _index(x, y) {
        assertInteger(x, "Tile X");
        assertInteger(y, "Tile Y");

        if (x >= this.width || y >= this.height)
            throw new RangeError("Tile coordinates out of bounds");

        return y * this.width + x;
    }

    getTile(x, y) {
        if (
            !Number.isInteger(x) ||
            !Number.isInteger(y) ||
            x < 0 || y < 0 ||
            x >= this.width ||
            y >= this.height
        ) {
            return 0;
        }

        return this.data[y * this.width + x];
    }

    setTile(x, y, id) {
        assertInteger(id, "Tile ID");

        this.data[this._index(x, y)] = id;

        return this;
    }

    removeTile(x, y) {
        return this.setTile(x, y, 0);
    }

    fill(id) {
        assertInteger(id, "Tile ID");
        this.data.fill(id);

        return this;
    }

    clear() {
        this.data.fill(0);
        return this;
    }

    fillRect(x, y, width, height, id) {
        assertInteger(x, "X");
        assertInteger(y, "Y");
        assertInteger(width, "Width");
        assertInteger(height, "Height");
        assertInteger(id, "Tile ID");

        for (let ty = y; ty < y + height; ty++) {
            for (let tx = x; tx < x + width; tx++) {
                if (
                    tx >= 0 && ty >= 0 &&
                    tx < this.width &&
                    ty < this.height
                ) {
                    this.setTile(tx, ty, id);
                }
            }
        }

        return this;
    }

    forEach(callback) {
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const id = this.getTile(x, y);

                callback(id, x, y);
            }
        }
    }

    getData() {
        return Array.from(this.data);
    }

    setData(data) {
        if (!Array.isArray(data) && !(data instanceof Uint32Array))
            throw new TypeError("Layer data must be an array");

        if (data.length !== this.data.length)
            throw new RangeError("Invalid layer data size");

        for (const id of data)
            assertInteger(id, "Tile ID");

        this.data.set(data);

        return this;
    }

    toJSON() {
        return {
            name: this.name,
            visible: this.visible,
            opacity: this.opacity,
            zIndex: this.zIndex,
            properties: { ...this.properties },
            data: this.getData()
        };
    }
}

// ============================================================
// TILEMAP
// ============================================================

export class Tilemap extends GameObject {
    constructor(options = {}) {
        super();

        this.name = options.name || "Tilemap";

        this.width = options.width ?? 20;
        this.height = options.height ?? 15;

        this.tileWidth = options.tileWidth ?? 16;
        this.tileHeight = options.tileHeight ?? 16;

        if (
            !Number.isInteger(this.width) ||
            !Number.isInteger(this.height) ||
            this.width <= 0 ||
            this.height <= 0
        ) {
            throw new RangeError("Invalid tilemap dimensions");
        }

        if (this.tileWidth <= 0 || this.tileHeight <= 0)
            throw new RangeError("Invalid tile dimensions");

        this.tileset = options.tileset ?? null;

        this.layers = [];
        this.layerMap = new Map();

        this.rendering = {
            smoothing: options.smoothing ?? false,
            culling: options.culling ?? true
        };

        this.createLayer("default");
    }

    setTileset(tileset) {
        if (!(tileset instanceof Tileset))
            throw new TypeError("Expected a Tileset");

        this.tileset = tileset;

        return this;
    }

    createLayer(name, options = {}) {
        if (this.layerMap.has(name))
            throw new Error(`Layer already exists: ${name}`);

        const layer = new TilemapLayer(
            name,
            this,
            options
        );

        this.layers.push(layer);
        this.layerMap.set(name, layer);

        return layer;
    }

    getLayer(name) {
        return this.layerMap.get(name) || null;
    }

    removeLayer(name) {
        const layer = this.getLayer(name);

        if (!layer)
            return false;

        this.layerMap.delete(name);

        this.layers.splice(
            this.layers.indexOf(layer),
            1
        );

        return true;
    }

    setTile(x, y, id, layer = "default") {
        const target = this.getLayer(layer);

        if (!target)
            throw new Error(`Layer not found: ${layer}`);

        target.setTile(x, y, id);

        return this;
    }

    getTile(x, y, layer = "default") {
        return this.getLayer(layer)?.getTile(x, y) ?? 0;
    }

    worldToTile(position) {
        const global = this.getGlobalPosition();

        return new Vec2(
            Math.floor((position.x - global.x) / this.tileWidth),
            Math.floor((position.y - global.y) / this.tileHeight)
        );
    }

    tileToWorld(x, y) {
        const global = this.getGlobalPosition();

        return new Vec2(
            global.x + x * this.tileWidth,
            global.y + y * this.tileHeight
        );
    }

    getTileProperties(id) {
        return this.tileset?.getTileProperties(id) || {};
    }

    getTileRect(x, y) {
        const position = this.tileToWorld(x, y);

        return new Rect(
            position.x,
            position.y,
            this.tileWidth,
            this.tileHeight
        );
    }

    getTileCount() {
        let count = 0;

        for (const layer of this.layers) {
            for (const id of layer.data) {
                if (id !== 0)
                    count++;
            }
        }

        return count;
    }

    // Visible tile range, relative to this map.
    _getVisibleRange(renderer) {
        if (
            !this.rendering.culling ||
            this.rotation !== 0 ||
            !this.scene
        ) {
            return {
                minX: 0,
                minY: 0,
                maxX: this.width - 1,
                maxY: this.height - 1
            };
        }

        const camera = this.scene.camera;

        const zoom = Math.max(0.0001, Math.abs(camera.zoom));

        const halfW = renderer.canvas.width / (2 * zoom);
        const halfH = renderer.canvas.height / (2 * zoom);

        const cos = Math.abs(Math.cos(camera.rotation));
        const sin = Math.abs(Math.sin(camera.rotation));

        const extentX = cos * halfW + sin * halfH;
        const extentY = sin * halfW + cos * halfH;

        const center = this.getGlobalPosition();

        const minX = camera.pos.x - extentX - center.x;
        const minY = camera.pos.y - extentY - center.y;

        const maxX = camera.pos.x + extentX - center.x;
        const maxY = camera.pos.y + extentY - center.y;

        return {
            minX: clamp(
                Math.floor(minX / this.tileWidth),
                0,
                this.width - 1
            ),
            minY: clamp(
                Math.floor(minY / this.tileHeight),
                0,
                this.height - 1
            ),
            maxX: clamp(
                Math.floor(maxX / this.tileWidth),
                0,
                this.width - 1
            ),
            maxY: clamp(
                Math.floor(maxY / this.tileHeight),
                0,
                this.height - 1
            )
        };
    }

    draw(renderer) {
        if (!this.tileset?.loaded)
            return;

        const ctx = renderer.ctx;
        const tileset = this.tileset;

        const range = this._getVisibleRange(renderer);

        const layers = [...this.layers].sort(
            (a, b) => a.zIndex - b.zIndex
        );

        ctx.imageSmoothingEnabled = this.rendering.smoothing;

        for (const layer of layers) {
            if (!layer.visible || layer.opacity <= 0)
                continue;

            ctx.save();
            ctx.globalAlpha *= layer.opacity;

            for (let y = range.minY; y <= range.maxY; y++) {
                for (let x = range.minX; x <= range.maxX; x++) {
                    const id = layer.getTile(x, y);

                    if (id === 0)
                        continue;

                    tileset.drawTile(
                        ctx,
                        id,
                        x * this.tileWidth,
                        y * this.tileHeight,
                        this.tileWidth,
                        this.tileHeight
                    );
                }
            }

            ctx.restore();
        }
    }

    toJSON() {
        return {
            width: this.width,
            height: this.height,
            tileWidth: this.tileWidth,
            tileHeight: this.tileHeight,

            pos: {
                x: this.pos.x,
                y: this.pos.y
            },

            layers: this.layers.map(
                layer => layer.toJSON()
            )
        };
    }

    static fromJSON(data, tileset = null) {
        const map = new Tilemap({
            width: data.width,
            height: data.height,
            tileWidth: data.tileWidth,
            tileHeight: data.tileHeight,
            tileset
        });

        map.layers = [];
        map.layerMap.clear();

        map.pos.set(
            data.pos?.x ?? 0,
            data.pos?.y ?? 0
        );

        for (const layerData of data.layers || []) {
            const layer = map.createLayer(
                layerData.name,
                layerData
            );

            layer.setData(layerData.data);
        }

        if (map.layers.length === 0)
            map.createLayer("default");

        return map;
    }
}

// ============================================================
// TILEMAP COLLIDER
// ============================================================

export class TilemapCollider {
    constructor(tilemap, options = {}) {
        if (!(tilemap instanceof Tilemap))
            throw new TypeError("Expected a Tilemap");

        this.tilemap = tilemap;

        this.layer = options.layer ?? "default";
        this.solidProperty = options.solidProperty ?? "solid";
    }

    isSolid(x, y) {
        const layer = this.tilemap.getLayer(this.layer);

        if (!layer)
            return false;

        const id = layer.getTile(x, y);

        if (id === 0)
            return false;

        return !!this.tilemap.getTileProperties(id)[
            this.solidProperty
        ];
    }

    getSolidTiles(rect) {
        const map = this.tilemap;

        const global = map.getGlobalPosition();

        const minX = Math.floor(
            (rect.x - global.x) / map.tileWidth
        );

        const minY = Math.floor(
            (rect.y - global.y) / map.tileHeight
        );

        const maxX = Math.floor(
            (rect.x + rect.width - global.x) / map.tileWidth
        );

        const maxY = Math.floor(
            (rect.y + rect.height - global.y) / map.tileHeight
        );

        const results = [];

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                if (!this.isSolid(x, y))
                    continue;

                results.push({
                    x,
                    y,
                    id: map.getTile(x, y, this.layer),
                    rect: map.getTileRect(x, y)
                });
            }
        }

        return results;
    }
}

// ============================================================
// TILEMAP LOADER
// ============================================================

export class TilemapLoader {
    static async load(source, tileset = null) {
        const response = await fetch(source);

        if (!response.ok) {
            throw new Error(
                `Failed to load tilemap: ${response.status}`
            );
        }

        const data = await response.json();

        return Tilemap.fromJSON(data, tileset);
    }

    static parse(json, tileset = null) {
        const data = typeof json === "string"
            ? JSON.parse(json)
            : json;

        return Tilemap.fromJSON(data, tileset);
    }

    static stringify(map, spacing = 0) {
        if (!(map instanceof Tilemap))
            throw new TypeError("Expected a Tilemap");

        return JSON.stringify(map.toJSON(), null, spacing);
    }
}

// ============================================================
// FACTORY
// ============================================================

export function createTilemap(options = {}) {
    return new Tilemap(options);
}

export function createTileset(options = {}) {
    return new Tileset(options);
}

export function createLayer(name, map, options = {}) {
    if (!(map instanceof Tilemap))
        throw new TypeError("Expected a Tilemap");

    return map.createLayer(name, options);
}

export function createCollider(tilemap, options = {}) {
    return new TilemapCollider(tilemap, options);
}

// ============================================================
// TILEMAP API
// ============================================================

export const TilemapPlugin = {
    Tilemap,
    TilemapLayer,
    Tileset,
    Tile,
    TilemapCollider,
    TilemapLoader,

    createTilemap,
    createTileset,
    createLayer,
    createCollider
};

export const TilemapAPI = TilemapPlugin;

export default TilemapPlugin;
