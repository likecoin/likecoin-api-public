/*eslint-disable block-scoped-var, id-length, no-control-regex, no-magic-numbers, no-prototype-builtins, no-redeclare, no-shadow, no-var, sort-vars*/
import * as $protobuf from "protobufjs/minimal";

// Common aliases
const $Reader = $protobuf.Reader, $Writer = $protobuf.Writer, $util = $protobuf.util;

// Exported root namespace
const $root = $protobuf.roots["default"] || ($protobuf.roots["default"] = {});

export const LikePayId = $root.LikePayId = (() => {

    /**
     * Properties of a LikePayId.
     * @exports ILikePayId
     * @interface ILikePayId
     * @property {Uint8Array|null} [uuid] LikePayId uuid
     * @property {Uint8Array|null} [address] LikePayId address
     * @property {Long|null} [amount] LikePayId amount
     */

    /**
     * Constructs a new LikePayId.
     * @exports LikePayId
     * @classdesc Represents a LikePayId.
     * @implements ILikePayId
     * @constructor
     * @param {ILikePayId=} [properties] Properties to set
     */
    function LikePayId(properties) {
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * LikePayId uuid.
     * @member {Uint8Array} uuid
     * @memberof LikePayId
     * @instance
     */
    LikePayId.prototype.uuid = $util.newBuffer([]);

    /**
     * LikePayId address.
     * @member {Uint8Array} address
     * @memberof LikePayId
     * @instance
     */
    LikePayId.prototype.address = $util.newBuffer([]);

    /**
     * LikePayId amount.
     * @member {Long} amount
     * @memberof LikePayId
     * @instance
     */
    LikePayId.prototype.amount = $util.Long ? $util.Long.fromBits(0,0,true) : 0;

    /**
     * Creates a new LikePayId instance using the specified properties.
     * @function create
     * @memberof LikePayId
     * @static
     * @param {ILikePayId=} [properties] Properties to set
     * @returns {LikePayId} LikePayId instance
     */
    LikePayId.create = function create(properties) {
        return new LikePayId(properties);
    };

    /**
     * Encodes the specified LikePayId message. Does not implicitly {@link LikePayId.verify|verify} messages.
     * @function encode
     * @memberof LikePayId
     * @static
     * @param {ILikePayId} message LikePayId message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    LikePayId.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        if (message.uuid != null && message.hasOwnProperty("uuid"))
            writer.uint32(/* id 1, wireType 2 =*/10).bytes(message.uuid);
        if (message.address != null && message.hasOwnProperty("address"))
            writer.uint32(/* id 2, wireType 2 =*/18).bytes(message.address);
        if (message.amount != null && message.hasOwnProperty("amount"))
            writer.uint32(/* id 3, wireType 0 =*/24).uint64(message.amount);
        return writer;
    };

    /**
     * Encodes the specified LikePayId message, length delimited. Does not implicitly {@link LikePayId.verify|verify} messages.
     * @function encodeDelimited
     * @memberof LikePayId
     * @static
     * @param {ILikePayId} message LikePayId message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    LikePayId.encodeDelimited = function encodeDelimited(message, writer) {
        return this.encode(message, writer).ldelim();
    };

    /**
     * Decodes a LikePayId message from the specified reader or buffer.
     * @function decode
     * @memberof LikePayId
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {LikePayId} LikePayId
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    LikePayId.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.LikePayId();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1:
                message.uuid = reader.bytes();
                break;
            case 2:
                message.address = reader.bytes();
                break;
            case 3:
                message.amount = reader.uint64();
                break;
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        return message;
    };

    /**
     * Decodes a LikePayId message from the specified reader or buffer, length delimited.
     * @function decodeDelimited
     * @memberof LikePayId
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @returns {LikePayId} LikePayId
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    LikePayId.decodeDelimited = function decodeDelimited(reader) {
        if (!(reader instanceof $Reader))
            reader = new $Reader(reader);
        return this.decode(reader, reader.uint32());
    };

    /**
     * Verifies a LikePayId message.
     * @function verify
     * @memberof LikePayId
     * @static
     * @param {Object.<string,*>} message Plain object to verify
     * @returns {string|null} `null` if valid, otherwise the reason why it is not
     */
    LikePayId.verify = function verify(message) {
        if (typeof message !== "object" || message === null)
            return "object expected";
        if (message.uuid != null && message.hasOwnProperty("uuid"))
            if (!(message.uuid && typeof message.uuid.length === "number" || $util.isString(message.uuid)))
                return "uuid: buffer expected";
        if (message.address != null && message.hasOwnProperty("address"))
            if (!(message.address && typeof message.address.length === "number" || $util.isString(message.address)))
                return "address: buffer expected";
        if (message.amount != null && message.hasOwnProperty("amount"))
            if (!$util.isInteger(message.amount) && !(message.amount && $util.isInteger(message.amount.low) && $util.isInteger(message.amount.high)))
                return "amount: integer|Long expected";
        return null;
    };

    /**
     * Creates a LikePayId message from a plain object. Also converts values to their respective internal types.
     * @function fromObject
     * @memberof LikePayId
     * @static
     * @param {Object.<string,*>} object Plain object
     * @returns {LikePayId} LikePayId
     */
    LikePayId.fromObject = function fromObject(object) {
        if (object instanceof $root.LikePayId)
            return object;
        let message = new $root.LikePayId();
        if (object.uuid != null)
            if (typeof object.uuid === "string")
                $util.base64.decode(object.uuid, message.uuid = $util.newBuffer($util.base64.length(object.uuid)), 0);
            else if (object.uuid.length)
                message.uuid = object.uuid;
        if (object.address != null)
            if (typeof object.address === "string")
                $util.base64.decode(object.address, message.address = $util.newBuffer($util.base64.length(object.address)), 0);
            else if (object.address.length)
                message.address = object.address;
        if (object.amount != null)
            if ($util.Long)
                (message.amount = $util.Long.fromValue(object.amount)).unsigned = true;
            else if (typeof object.amount === "string")
                message.amount = parseInt(object.amount, 10);
            else if (typeof object.amount === "number")
                message.amount = object.amount;
            else if (typeof object.amount === "object")
                message.amount = new $util.LongBits(object.amount.low >>> 0, object.amount.high >>> 0).toNumber(true);
        return message;
    };

    /**
     * Creates a plain object from a LikePayId message. Also converts values to other types if specified.
     * @function toObject
     * @memberof LikePayId
     * @static
     * @param {LikePayId} message LikePayId
     * @param {$protobuf.IConversionOptions} [options] Conversion options
     * @returns {Object.<string,*>} Plain object
     */
    LikePayId.toObject = function toObject(message, options) {
        if (!options)
            options = {};
        let object = {};
        if (options.defaults) {
            if (options.bytes === String)
                object.uuid = "";
            else {
                object.uuid = [];
                if (options.bytes !== Array)
                    object.uuid = $util.newBuffer(object.uuid);
            }
            if (options.bytes === String)
                object.address = "";
            else {
                object.address = [];
                if (options.bytes !== Array)
                    object.address = $util.newBuffer(object.address);
            }
            if ($util.Long) {
                let long = new $util.Long(0, 0, true);
                object.amount = options.longs === String ? long.toString() : options.longs === Number ? long.toNumber() : long;
            } else
                object.amount = options.longs === String ? "0" : 0;
        }
        if (message.uuid != null && message.hasOwnProperty("uuid"))
            object.uuid = options.bytes === String ? $util.base64.encode(message.uuid, 0, message.uuid.length) : options.bytes === Array ? Array.prototype.slice.call(message.uuid) : message.uuid;
        if (message.address != null && message.hasOwnProperty("address"))
            object.address = options.bytes === String ? $util.base64.encode(message.address, 0, message.address.length) : options.bytes === Array ? Array.prototype.slice.call(message.address) : message.address;
        if (message.amount != null && message.hasOwnProperty("amount"))
            if (typeof message.amount === "number")
                object.amount = options.longs === String ? String(message.amount) : message.amount;
            else
                object.amount = options.longs === String ? $util.Long.prototype.toString.call(message.amount) : options.longs === Number ? new $util.LongBits(message.amount.low >>> 0, message.amount.high >>> 0).toNumber(true) : message.amount;
        return object;
    };

    /**
     * Converts this LikePayId to JSON.
     * @function toJSON
     * @memberof LikePayId
     * @instance
     * @returns {Object.<string,*>} JSON object
     */
    LikePayId.prototype.toJSON = function toJSON() {
        return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
    };

    return LikePayId;
})();

export { $root as default };
