"use strict";
/**
 * Shared coercion for values coming out of an XML parse.
 *
 * Every function here exists because of one recurring failure: a camera sends a
 * *richer* shape than the documented example, fast-xml-parser represents it as an
 * object, and `String(obj)` renders "[object Object]" straight into the user's
 * terminal. That was found on a real AXIS M1137 at 10.12.300, whose
 * `applications/info.cgi` sends `<sdk version="3.5">acap3</sdk>` where Axis
 * documents a bare `<sdk>acap3</sdk>`.
 *
 * The class of bug matters more than the instance: it produces confidently wrong
 * output rather than an error, so nothing — not an exit code, not a schema —
 * catches it. Anything reaching a template string or a table cell goes through
 * `str()` first.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.xmlParser = void 0;
exports.str = str;
exports.bool = bool;
exports.int = int;
exports.asArray = asArray;
exports.attr = attr;
exports.findElements = findElements;
const fast_xml_parser_1 = require("fast-xml-parser");
/** The key fast-xml-parser uses for an element's text when it also has attributes. */
const TEXT_KEY = '#text';
exports.xmlParser = new fast_xml_parser_1.XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    allowBooleanAttributes: true,
    // Attribute values stay strings. Version numbers like "1.20" would otherwise
    // become the number 1.2 and lose the trailing digit — which is exactly the
    // value that gates applications/list.cgi.
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: true,
});
/**
 * Coerce a parsed XML value to a string, or null when there is no sensible one.
 *
 * Returning null rather than a stringified object is deliberate: callers already
 * render null as "-" or "not reported", which is honest. "[object Object]" is not.
 */
function str(v) {
    if (v === undefined || v === null)
        return null;
    if (typeof v === 'string') {
        const s = v.trim();
        return s === '' ? null : s;
    }
    if (typeof v === 'number' || typeof v === 'boolean')
        return String(v);
    // An element with both text and attributes: `<Version major="1">1.20</Version>`.
    if (typeof v === 'object') {
        if (Array.isArray(v)) {
            // Repeated element. Join the parts that do coerce; drop the rest.
            const parts = v.map(str).filter((s) => s !== null);
            return parts.length > 0 ? parts.join(', ') : null;
        }
        const obj = v;
        const text = str(obj[TEXT_KEY]);
        if (text !== null)
            return text;
        // No text node. A single attribute is unambiguous enough to use; more than
        // one would be a guess, so give up rather than pick arbitrarily.
        const keys = Object.keys(obj);
        if (keys.length === 1)
            return str(obj[keys[0]]);
        return null;
    }
    return null;
}
/** Axis mixes yes/no and true/false in the same responses; accept both, plus 1/0 and on/off. */
function bool(v) {
    const s = str(v)?.toLowerCase();
    if (s === undefined || s === null)
        return null;
    if (s === 'yes' || s === 'true' || s === '1' || s === 'on')
        return true;
    if (s === 'no' || s === 'false' || s === '0' || s === 'off')
        return false;
    return null;
}
/**
 * Parse an integer, rejecting anything that is not purely numeric.
 *
 * `parseInt` would turn "1.9 GB" into 1, and a capacity of "1 kB" reported with
 * total confidence is worse than reporting nothing.
 */
function int(v) {
    const s = str(v);
    if (s === null)
        return null;
    if (!/^-?\d+$/.test(s))
        return null;
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : null;
}
function asArray(v) {
    if (v === undefined || v === null)
        return [];
    return Array.isArray(v) ? v : [v];
}
/**
 * Case-insensitive attribute lookup.
 *
 * Axis' own documentation warns that these responses mix conventions within a
 * single reply, so assuming exact attribute casing across firmware generations is
 * optimistic. Accepting any casing costs nothing and removes a class of silent
 * nulls.
 */
function attr(node, ...names) {
    for (const name of names) {
        if (name in node)
            return node[name];
    }
    const wanted = names.map((n) => n.toLowerCase());
    for (const [k, v] of Object.entries(node)) {
        if (wanted.includes(k.toLowerCase()))
            return v;
    }
    return undefined;
}
/**
 * Collect every descendant element with a given local name, at any depth and
 * regardless of namespace prefix.
 *
 * Needed because hardcoding a path like `root.disks.disk` breaks on the several
 * shapes real devices produce — a namespaced root, a missing wrapper element, or
 * two wrapper blocks (which makes the wrapper an array and the path undefined).
 * Every one of those silently yielded "no disks", which the CLI then reported as
 * "no SD card".
 */
function findElements(node, localName) {
    const wanted = localName.toLowerCase();
    const found = [];
    const visit = (value) => {
        if (Array.isArray(value)) {
            for (const item of value)
                visit(item);
            return;
        }
        if (typeof value !== 'object' || value === null)
            return;
        for (const [key, child] of Object.entries(value)) {
            // Strip any namespace prefix: "ns:disk" and "disk" are the same element.
            const local = key.includes(':') ? key.slice(key.indexOf(':') + 1) : key;
            if (local.toLowerCase() === wanted) {
                for (const item of asArray(child)) {
                    // A text-only element (`<disk>x</disk>`) is not a record of
                    // attributes and cannot be one of the elements we want.
                    if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
                        found.push(item);
                    }
                }
                continue;
            }
            visit(child);
        }
    };
    visit(node);
    return found;
}
