import sanitizeHtml from "sanitize-html";

/**
 * Sanitise a caught message's HTML for rendering. This runs at the DTO boundary (egress), never against
 * the stored `.eml`, so the raw-source view still shows exactly what was caught. It strips scripts, event
 * handlers, iframes/objects and `javascript:` URLs while keeping the formatting real email actually uses
 * (images, tables, inline styles, links).
 */
export const sanitiseEmailHtml = (html: string): string =>
    sanitizeHtml(html, {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat([
            "img",
            "hr",
            "font",
            "center",
            "u",
            "s",
            "strike",
            "span",
        ]),
        allowedAttributes: {
            "*": ["style", "class", "align", "valign", "dir", "width", "height", "bgcolor", "color"],
            a: ["href", "name", "target", "rel"],
            img: ["src", "alt", "title", "width", "height"],
            font: ["face", "size", "color"],
            table: ["border", "cellpadding", "cellspacing"],
        },
        allowedSchemes: ["http", "https", "mailto", "tel", "cid"],
        allowedSchemesByTag: { img: ["http", "https", "cid", "data"] },
        allowProtocolRelative: false,
    });
