
import { Vec2 } from "lib@engine";

// ============================================================
// PHYSICS2D - TGame Physics Plugin
// ============================================================

let nextBodyId = 1;

const EPSILON = 0.000001;

function vec(x = 0, y = 0) {
    return new Vec2(x, y);
}

function add(a, b) {
    return vec(a.x + b.x, a.y + b.y);
}

function sub(a, b) {
    return vec(a.x - b.x, a.y - b.y);
}

function mul(a, scalar) {
    return vec(a.x * scalar, a.y * scalar);
}

function dot(a, b) {
    return a.x * b.x + a.y * b.y;
}

function length(a) {
    return Math.sqrt(dot(a, a));
}

function normalize(a) {
    const len = length(a);

    if (len < EPSILON)
        return vec(0, 0);

    return mul(a, 1 / len);
}

function distance(a, b) {
    return length(sub(a, b));
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function cross(a, b) {
    return a.x * b.y - a.y * b.x;
}

function rotate(v, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);

    return vec(
        v.x * c - v.y * s,
        v.x * s + v.y * c
    );
}

// ============================================================
// COLLIDERS
// ============================================================

export class Collider {
    constructor(options = {}) {
        this.offset = options.offset || vec();

        this.isTrigger = options.isTrigger || false;

        this.layer = options.layer ?? 1;
        this.mask = options.mask ?? 0xFFFFFFFF;

        this.enabled = true;
        this.body = null;
    }

    getPosition() {
        if (!this.body)
            return this.offset;

        return add(this.body.position, this.offset);
    }

    canCollide(other) {
        return (
            (this.mask & other.layer) !== 0 &&
            (other.mask & this.layer) !== 0
        );
    }
}

export class BoxCollider extends Collider {
    constructor(width = 16, height = 16, options = {}) {
        super(options);

        this.width = width;
        this.height = height;
    }

    getBounds() {
        const p = this.getPosition();

        return {
            minX: p.x - this.width / 2,
            minY: p.y - this.height / 2,
            maxX: p.x + this.width / 2,
            maxY: p.y + this.height / 2
        };
    }
}

export class CircleCollider extends Collider {
    constructor(radius = 8, options = {}) {
        super(options);

        this.radius = radius;
    }
}

// ============================================================
// RIGIDBODY
// ============================================================

export class Rigidbody {
    constructor(gameObject = null, options = {}) {
        this.id = nextBodyId++;

        this.gameObject = gameObject;

        this.type = options.type || "dynamic";

        if (!["dynamic", "static", "kinematic"].includes(this.type))
            throw new Error(`Invalid Rigidbody type: ${this.type}`);

        this._position = vec(
            options.x ?? gameObject?.pos?.x ?? 0,
            options.y ?? gameObject?.pos?.y ?? 0
        );

        this.velocity = vec();
        this.acceleration = vec();

        this.force = vec();

        this.mass = Math.max(EPSILON, options.mass ?? 1);
        this.inverseMass = this.type === "dynamic"
            ? 1 / this.mass
            : 0;

        this.gravityScale = options.gravityScale ?? 1;

        this.linearDamping = options.linearDamping ?? 0;

        this.restitution = clamp(options.restitution ?? 0, 0, 1);
        this.friction = Math.max(0, options.friction ?? 0.3);

        this.fixedRotation = options.fixedRotation ?? true;

        this.rotation = options.rotation ?? 0;
        this.angularVelocity = 0;
        this.torque = 0;

        this.sleeping = false;
        this.enabled = true;

        this.colliders = [];

        this.onCollisionEnter = null;
        this.onCollisionStay = null;
        this.onCollisionExit = null;

        this.onTriggerEnter = null;
        this.onTriggerExit = null;

        this.userData = options.userData ?? null;
    }

    get position() {
        if (this.gameObject?.pos)
            return this.gameObject.pos;

        return this._position;
    }

    set position(value) {
        this._position = vec(value.x, value.y);

        if (this.gameObject?.pos) {
            this.gameObject.pos.x = value.x;
            this.gameObject.pos.y = value.y;
        }
    }

    setType(type) {
        if (!["dynamic", "static", "kinematic"].includes(type))
            throw new Error(`Invalid Rigidbody type: ${type}`);

        this.type = type;

        this.inverseMass = type === "dynamic"
            ? 1 / this.mass
            : 0;

        return this;
    }

    setMass(mass) {
        this.mass = Math.max(EPSILON, mass);

        this.inverseMass = this.type === "dynamic"
            ? 1 / this.mass
            : 0;

        return this;
    }

    addCollider(collider) {
        if (!(collider instanceof Collider))
            throw new TypeError("Expected a Collider");

        collider.body = this;

        this.colliders.push(collider);

        return collider;
    }

    removeCollider(collider) {
        const index = this.colliders.indexOf(collider);

        if (index === -1)
            return false;

        collider.body = null;
        this.colliders.splice(index, 1);

        return true;
    }

    applyForce(force) {
        if (this.type !== "dynamic")
            return;

        this.force.x += force.x;
        this.force.y += force.y;

        this.sleeping = false;
    }

    applyImpulse(impulse) {
        if (this.type !== "dynamic")
            return;

        this.velocity.x += impulse.x * this.inverseMass;
        this.velocity.y += impulse.y * this.inverseMass;

        this.sleeping = false;
    }

    move(position) {
        this.position = position;
        return this;
    }

    setVelocity(velocity) {
        this.velocity = vec(velocity.x, velocity.y);
        this.sleeping = false;

        return this;
    }

    stop() {
        this.velocity = vec();
        this.acceleration = vec();
        this.force = vec();

        return this;
    }

    addForceAtPoint(force, point) {
        this.applyForce(force);

        if (!this.fixedRotation) {
            const arm = sub(point, this.position);
            this.torque += cross(arm, force);
        }
    }

    integrate(gravity, delta) {
        if (!this.enabled || this.sleeping)
            return;

        if (this.type !== "dynamic")
            return;

        const acceleration = add(
            gravity.clone ? gravity.clone() : vec(gravity.x, gravity.y),
            mul(this.force, this.inverseMass)
        );

        acceleration.x *= this.gravityScale;
        acceleration.y *= this.gravityScale;

        this.velocity.x += acceleration.x * delta;
        this.velocity.y += acceleration.y * delta;

        const damping = Math.max(
            0,
            1 - this.linearDamping * delta
        );

        this.velocity.x *= damping;
        this.velocity.y *= damping;

        this.position.x += this.velocity.x * delta;
        this.position.y += this.velocity.y * delta;

        if (!this.fixedRotation) {
            this.angularVelocity += this.torque * this.inverseMass * delta;
            this.rotation += this.angularVelocity * delta;
        }

        this.force = vec();
        this.torque = 0;
    }
}

// ============================================================
// COLLISION DETECTION
// ============================================================

function boxBox(a, b) {
    const A = a.getBounds();
    const B = b.getBounds();

    const overlapX = Math.min(A.maxX, B.maxX) -
                     Math.max(A.minX, B.minX);

    const overlapY = Math.min(A.maxY, B.maxY) -
                     Math.max(A.minY, B.minY);

    if (overlapX <= 0 || overlapY <= 0)
        return null;

    const pa = a.getPosition();
    const pb = b.getPosition();

    if (overlapX < overlapY) {
        return {
            normal: vec(pb.x >= pa.x ? 1 : -1, 0),
            penetration: overlapX,
            point: vec(
                (Math.max(A.minX, B.minX) +
                 Math.min(A.maxX, B.maxX)) / 2,
                (Math.max(A.minY, B.minY) +
                 Math.min(A.maxY, B.maxY)) / 2
            )
        };
    }

    return {
        normal: vec(0, pb.y >= pa.y ? 1 : -1),
        penetration: overlapY,
        point: vec(
            (Math.max(A.minX, B.minX) +
             Math.min(A.maxX, B.maxX)) / 2,
            (Math.max(A.minY, B.minY) +
             Math.min(A.maxY, B.maxY)) / 2
        )
    };
}

function circleCircle(a, b) {
    const pa = a.getPosition();
    const pb = b.getPosition();

    const difference = sub(pb, pa);
    const dist = length(difference);

    const penetration = a.radius + b.radius - dist;

    if (penetration <= 0)
        return null;

    const normal = dist < EPSILON
        ? vec(1, 0)
        : mul(difference, 1 / dist);

    return {
        normal,
        penetration,
        point: add(
            pa,
            mul(normal, a.radius - penetration / 2)
        )
    };
}

function circleBox(circle, box) {
    const center = circle.getPosition();
    const bounds = box.getBounds();

    const closest = vec(
        clamp(center.x, bounds.minX, bounds.maxX),
        clamp(center.y, bounds.minY, bounds.maxY)
    );

    const difference = sub(closest, center);
    const dist = length(difference);

    if (dist >= circle.radius)
        return null;

    let normal;

    if (dist < EPSILON) {
        const distances = [
            center.x - bounds.minX,
            bounds.maxX - center.x,
            center.y - bounds.minY,
            bounds.maxY - center.y
        ];

        const min = Math.min(...distances);

        if (min === distances[0]) normal = vec(-1, 0);
        else if (min === distances[1]) normal = vec(1, 0);
        else if (min === distances[2]) normal = vec(0, -1);
        else normal = vec(0, 1);
    } else {
        normal = mul(difference, 1 / dist);
    }

    return {
        normal,
        penetration: circle.radius - dist,
        point: closest
    };
}

function detectCollision(a, b) {
    if (a instanceof BoxCollider && b instanceof BoxCollider)
        return boxBox(a, b);

    if (a instanceof CircleCollider && b instanceof CircleCollider)
        return circleCircle(a, b);

    if (a instanceof CircleCollider && b instanceof BoxCollider)
        return circleBox(a, b);

    if (a instanceof BoxCollider && b instanceof CircleCollider) {
        const result = circleBox(b, a);

        if (!result)
            return null;

        result.normal = mul(result.normal, -1);

        return result;
    }

    return null;
}

// ============================================================
// COLLISION RESPONSE
// ============================================================

function resolveCollision(bodyA, bodyB, contact) {
    if (bodyA.type === "static" && bodyB.type === "static")
        return;

    if (bodyA.type === "kinematic" && bodyB.type === "kinematic")
        return;

    const invA = bodyA.inverseMass;
    const invB = bodyB.inverseMass;

    const totalInverseMass = invA + invB;

    if (totalInverseMass <= 0)
        return;

    const normal = contact.normal;

    const relativeVelocity = sub(
        bodyB.velocity,
        bodyA.velocity
    );

    const velocityAlongNormal = dot(relativeVelocity, normal);

    if (velocityAlongNormal > 0)
        return;

    const restitution = Math.min(
        bodyA.restitution,
        bodyB.restitution
    );

    let impulseMagnitude =
        -(1 + restitution) * velocityAlongNormal;

    impulseMagnitude /= totalInverseMass;

    const impulse = mul(normal, impulseMagnitude);

    if (invA > 0) {
        bodyA.velocity.x -= impulse.x * invA;
        bodyA.velocity.y -= impulse.y * invA;
    }

    if (invB > 0) {
        bodyB.velocity.x += impulse.x * invB;
        bodyB.velocity.y += impulse.y * invB;
    }

    // Friction impulse

    const tangentVelocity = sub(
        relativeVelocity,
        mul(normal, dot(relativeVelocity, normal))
    );

    const tangent = normalize(tangentVelocity);

    let frictionImpulse = -dot(relativeVelocity, tangent);
    frictionImpulse /= totalInverseMass;

    const friction = Math.sqrt(
        bodyA.friction * bodyB.friction
    );

    frictionImpulse = clamp(
        frictionImpulse,
        -impulseMagnitude * friction,
        impulseMagnitude * friction
    );

    const frictionVector = mul(tangent, frictionImpulse);

    if (invA > 0) {
        bodyA.velocity.x -= frictionVector.x * invA;
        bodyA.velocity.y -= frictionVector.y * invA;
    }

    if (invB > 0) {
        bodyB.velocity.x += frictionVector.x * invB;
        bodyB.velocity.y += frictionVector.y * invB;
    }

    // Positional correction

    const percent = 0.8;
    const slop = 0.01;

    const correctionMagnitude =
        Math.max(contact.penetration - slop, 0) /
        totalInverseMass * percent;

    const correction = mul(normal, correctionMagnitude);

    if (invA > 0) {
        bodyA.position.x -= correction.x * invA;
        bodyA.position.y -= correction.y * invA;
    }

    if (invB > 0) {
        bodyB.position.x += correction.x * invB;
        bodyB.position.y += correction.y * invB;
    }
}

// ============================================================
// DISTANCE JOINT
// ============================================================

export class DistanceJoint {
    constructor(bodyA, bodyB, options = {}) {
        this.bodyA = bodyA;
        this.bodyB = bodyB;

        this.length = options.length ??
            distance(bodyA.position, bodyB.position);

        this.stiffness = options.stiffness ?? 1;
        this.enabled = true;
    }

    solve() {
        if (!this.enabled)
            return;

        const a = this.bodyA;
        const b = this.bodyB;

        const delta = sub(b.position, a.position);
        const dist = length(delta);

        if (dist < EPSILON)
            return;

        const difference = (dist - this.length) * this.stiffness;
        const correction = mul(delta, difference / dist);

        const invA = a.inverseMass;
        const invB = b.inverseMass;
        const total = invA + invB;

        if (total <= 0)
            return;

        if (invA > 0) {
            a.position.x += correction.x * invA / total;
            a.position.y += correction.y * invA / total;
        }

        if (invB > 0) {
            b.position.x -= correction.x * invB / total;
            b.position.y -= correction.y * invB / total;
        }
    }
}

// ============================================================
// RAYCAST
// ============================================================

function raycastBox(origin, direction, maxDistance, collider) {
    const bounds = collider.getBounds();

    let tMin = 0;
    let tMax = maxDistance;

    let normal = vec();

    const axes = [
        {
            origin: origin.x,
            direction: direction.x,
            min: bounds.minX,
            max: bounds.maxX,
            negative: vec(-1, 0),
            positive: vec(1, 0)
        },
        {
            origin: origin.y,
            direction: direction.y,
            min: bounds.minY,
            max: bounds.maxY,
            negative: vec(0, -1),
            positive: vec(0, 1)
        }
    ];

    for (const axis of axes) {
        if (Math.abs(axis.direction) < EPSILON) {
            if (axis.origin < axis.min || axis.origin > axis.max)
                return null;

            continue;
        }

        let t1 = (axis.min - axis.origin) / axis.direction;
        let t2 = (axis.max - axis.origin) / axis.direction;

        let n = axis.negative;

        if (t1 > t2) {
            [t1, t2] = [t2, t1];
            n = axis.positive;
        }

        if (t1 > tMin) {
            tMin = t1;
            normal = n;
        }

        tMax = Math.min(tMax, t2);

        if (tMin > tMax)
            return null;
    }

    if (tMin < 0 || tMin > maxDistance)
        return null;

    return {
        collider,
        body: collider.body,
        distance: tMin,
        point: add(origin, mul(direction, tMin)),
        normal
    };
}

function raycastCircle(origin, direction, maxDistance, collider) {
    const center = collider.getPosition();
    const offset = sub(origin, center);

    const a = dot(direction, direction);
    const b = 2 * dot(offset, direction);
    const c = dot(offset, offset) - collider.radius ** 2;

    const discriminant = b * b - 4 * a * c;

    if (discriminant < 0)
        return null;

    const root = Math.sqrt(discriminant);

    let t = (-b - root) / (2 * a);

    if (t < 0)
        t = (-b + root) / (2 * a);

    if (t < 0 || t > maxDistance)
        return null;

    const point = add(origin, mul(direction, t));

    return {
        collider,
        body: collider.body,
        distance: t,
        point,
        normal: normalize(sub(point, center))
    };
}

// ============================================================
// PHYSICS WORLD
// ============================================================

export class PhysicsWorld {
    constructor(options = {}) {
        this.gravity = options.gravity || vec(0, 9.81 * 10);

        this.fixedDelta = options.fixedDelta ?? 1 / 60;
        this.maxSubSteps = options.maxSubSteps ?? 8;

        this.velocityIterations = options.velocityIterations ?? 1;
        this.positionIterations = options.positionIterations ?? 3;

        this.bodies = [];
        this.joints = [];

        this.accumulator = 0;

        this.contacts = new Map();

        this.timeScale = 1;
        this.paused = false;

        this.debug = false;
    }

    addBody(gameObject, options = {}) {
        const body = new Rigidbody(gameObject, options);

        if (options.collider) {
            body.addCollider(options.collider);
        }

        this.bodies.push(body);

        return body;
    }

    addRigidbody(body) {
        if (!(body instanceof Rigidbody))
            throw new TypeError("Expected a Rigidbody");

        if (!this.bodies.includes(body))
            this.bodies.push(body);

        return body;
    }

    removeBody(body) {
        const index = this.bodies.indexOf(body);

        if (index === -1)
            return false;

        this.bodies.splice(index, 1);

        for (const collider of body.colliders)
            collider.body = null;

        for (const [key, contact] of this.contacts) {
            if (contact.bodyA === body || contact.bodyB === body) {
                this._emitExit(contact);
                this.contacts.delete(key);
            }
        }

        return true;
    }

    addJoint(joint) {
        if (!(joint instanceof DistanceJoint))
            throw new TypeError("Expected a DistanceJoint");

        this.joints.push(joint);

        return joint;
    }

    removeJoint(joint) {
        const index = this.joints.indexOf(joint);

        if (index === -1)
            return false;

        this.joints.splice(index, 1);

        return true;
    }

    update(delta) {
        if (this.paused)
            return;

        const frameDelta = Math.min(
            Math.max(0, delta * this.timeScale),
            this.fixedDelta * this.maxSubSteps
        );

        this.accumulator += frameDelta;

        let steps = 0;

        while (
            this.accumulator >= this.fixedDelta &&
            steps < this.maxSubSteps
        ) {
            this.step(this.fixedDelta);

            this.accumulator -= this.fixedDelta;
            steps++;
        }
    }

    step(delta = this.fixedDelta) {
        // Integrate movement

        for (const body of this.bodies)
            body.integrate(this.gravity, delta);

        // Detect collisions

        const currentContacts = new Map();

        for (let i = 0; i < this.bodies.length; i++) {
            const bodyA = this.bodies[i];

            if (!bodyA.enabled)
                continue;

            for (let j = i + 1; j < this.bodies.length; j++) {
                const bodyB = this.bodies[j];

                if (!bodyB.enabled)
                    continue;

                if (
                    bodyA.inverseMass === 0 &&
                    bodyB.inverseMass === 0
                ) {
                    continue;
                }

                for (const colliderA of bodyA.colliders) {
                    if (!colliderA.enabled)
                        continue;

                    for (const colliderB of bodyB.colliders) {
                        if (!colliderB.enabled)
                            continue;

                        if (!colliderA.canCollide(colliderB))
                            continue;

                        const collision = detectCollision(
                            colliderA,
                            colliderB
                        );

                        if (!collision)
                            continue;

                        const key = [
                            bodyA.id,
                            colliderA === bodyA.colliders[0] ? 0 : bodyA.colliders.indexOf(colliderA),
                            bodyB.id,
                            bodyB.colliders.indexOf(colliderB)
                        ].join(":");

                        const contact = {
                            key,
                            bodyA,
                            bodyB,
                            colliderA,
                            colliderB,
                            ...collision
                        };

                        currentContacts.set(key, contact);

                        if (
                            !colliderA.isTrigger &&
                            !colliderB.isTrigger
                        ) {
                            for (let iteration = 0; iteration < this.velocityIterations; iteration++) {
                                resolveCollision(bodyA, bodyB, contact);
                            }
                        }
                    }
                }
            }
        }

        // Solve joints

        for (let i = 0; i < this.positionIterations; i++) {
            for (const joint of this.joints)
                joint.solve();
        }

        // Collision events

        for (const [key, contact] of currentContacts) {
            const wasTouching = this.contacts.has(key);

            if (contact.colliderA.isTrigger || contact.colliderB.isTrigger) {
                if (!wasTouching)
                    this._emitTrigger(contact, "enter");
            } else {
                this._emitCollision(contact, wasTouching);
            }
        }

        for (const [key, contact] of this.contacts) {
            if (!currentContacts.has(key))
                this._emitExit(contact);
        }

        this.contacts = currentContacts;
    }

    _emitCollision(contact, wasTouching) {
        const event = {
            body: contact.bodyB,
            other: contact.bodyA,
            collider: contact.colliderB,
            otherCollider: contact.colliderA,
            point: contact.point,
            normal: contact.normal,
            penetration: contact.penetration
        };

        const reverseEvent = {
            ...event,
            body: contact.bodyA,
            other: contact.bodyB,
            collider: contact.colliderA,
            otherCollider: contact.colliderB,
            normal: mul(contact.normal, -1)
        };

        const callback = wasTouching
            ? "onCollisionStay"
            : "onCollisionEnter";

        contact.bodyA[callback]?.(reverseEvent);
        contact.bodyB[callback]?.(event);

        contact.bodyA.gameObject?.[callback]?.(reverseEvent);
        contact.bodyB.gameObject?.[callback]?.(event);
    }

    _emitTrigger(contact, type) {
        const callback = type === "enter"
            ? "onTriggerEnter"
            : "onTriggerExit";

        contact.bodyA[callback]?.({
            body: contact.bodyB,
            other: contact.bodyA
        });

        contact.bodyB[callback]?.({
            body: contact.bodyA,
            other: contact.bodyB
        });

        contact.bodyA.gameObject?.[callback]?.({
            body: contact.bodyB
        });

        contact.bodyB.gameObject?.[callback]?.({
            body: contact.bodyA
        });
    }

    _emitExit(contact) {
        if (contact.colliderA.isTrigger || contact.colliderB.isTrigger) {
            this._emitTrigger(contact, "exit");
            return;
        }

        const event = {
            body: contact.bodyB,
            other: contact.bodyA
        };

        contact.bodyA.onCollisionExit?.(event);
        contact.bodyB.onCollisionExit?.({
            body: contact.bodyA,
            other: contact.bodyB
        });

        contact.bodyA.gameObject?.onCollisionExit?.(event);
        contact.bodyB.gameObject?.onCollisionExit?.({
            body: contact.bodyA
        });
    }

    raycast(origin, direction, maxDistance = Infinity, options = {}) {
        const dir = normalize(direction);

        if (length(dir) < EPSILON)
            return null;

        const hits = [];

        for (const body of this.bodies) {
            if (!body.enabled)
                continue;

            for (const collider of body.colliders) {
                if (!collider.enabled)
                    continue;

                if (options.layer !== undefined) {
                    if ((options.layer & collider.layer) === 0)
                        continue;
                }

                const hit = collider instanceof BoxCollider
                    ? raycastBox(origin, dir, maxDistance, collider)
                    : collider instanceof CircleCollider
                        ? raycastCircle(origin, dir, maxDistance, collider)
                        : null;

                if (hit)
                    hits.push(hit);
            }
        }

        hits.sort((a, b) => a.distance - b.distance);

        return options.all ? hits : hits[0] || null;
    }

    overlapCircle(position, radius, options = {}) {
        const query = new CircleCollider(radius);
        query.offset = position;

        const results = [];

        for (const body of this.bodies) {
            if (!body.enabled)
                continue;

            for (const collider of body.colliders) {
                if (!collider.enabled)
                    continue;

                if (!query.canCollide(collider))
                    continue;

                const hit = detectCollision(query, collider);

                if (hit)
                    results.push({
                        body,
                        collider,
                        ...hit
                    });
            }
        }

        return results;
    }

    overlapBox(position, width, height) {
        const query = new BoxCollider(width, height);
        query.offset = position;

        const results = [];

        for (const body of this.bodies) {
            for (const collider of body.colliders) {
                if (!collider.enabled)
                    continue;

                const hit = detectCollision(query, collider);

                if (hit)
                    results.push({
                        body,
                        collider,
                        ...hit
                    });
            }
        }

        return results;
    }

    clear() {
        for (const body of this.bodies) {
            for (const collider of body.colliders)
                collider.body = null;
        }

        this.bodies.length = 0;
        this.joints.length = 0;
        this.contacts.clear();
        this.accumulator = 0;
    }

    debugDraw(ctx) {
        if (!ctx)
            return;

        ctx.save();

        for (const body of this.bodies) {
            for (const collider of body.colliders) {
                if (!collider.enabled)
                    continue;

                ctx.beginPath();

                if (collider instanceof CircleCollider) {
                    const p = collider.getPosition();

                    ctx.arc(
                        p.x,
                        p.y,
                        collider.radius,
                        0,
                        Math.PI * 2
                    );
                } else if (collider instanceof BoxCollider) {
                    const bounds = collider.getBounds();

                    ctx.rect(
                        bounds.minX,
                        bounds.minY,
                        collider.width,
                        collider.height
                    );
                }

                ctx.strokeStyle = collider.isTrigger
                    ? "#e0b400"
                    : body.type === "static"
                        ? "#44aaff"
                        : "#00ff88";

                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }

        ctx.restore();
    }
}

// ============================================================
// FACTORY
// ============================================================

export function createWorld(options = {}) {
    return new PhysicsWorld(options);
}

export function createBox(width, height, options = {}) {
    return new BoxCollider(width, height, options);
}

export function createCircle(radius, options = {}) {
    return new CircleCollider(radius, options);
}

export function createJoint(bodyA, bodyB, options = {}) {
    return new DistanceJoint(bodyA, bodyB, options);
}

export const Physics2D = {
    PhysicsWorld,
    Rigidbody,
    Collider,
    BoxCollider,
    CircleCollider,
    DistanceJoint,

    createWorld,
    createBox,
    createCircle,
    createJoint,

    Vec2
};

export default Physics2D;
