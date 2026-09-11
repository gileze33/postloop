import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect } from "react";

interface EditorProps {
    value: string;
    onChange: (html: string) => void;
    placeholder?: string;
}

// A rich-text editor for message bodies. StarterKit already bundles bold/italic/underline/strike,
// headings, lists, blockquote and links; Placeholder is the only extra.
// TODO (attachments slice): a toolbar control to attach files inline (currently attachments sit below).
export const Editor = ({ value, onChange, placeholder }: EditorProps) => {
    const editor = useEditor({
        extensions: [StarterKit, Placeholder.configure({ placeholder: placeholder ?? "Write your message..." })],
        content: value,
        onUpdate: ({ editor: instance }) => onChange(instance.getHTML()),
    });

    // Let the parent clear the editor (e.g. after a successful send) by setting value back to "".
    useEffect(() => {
        if (editor && value === "" && editor.getText() !== "") {
            editor.commands.clearContent();
        }
    }, [editor, value]);

    if (!editor) {
        return null;
    }

    const setLink = () => {
        const previous = editor.getAttributes("link").href as string | undefined;
        const url = window.prompt("Link URL", previous ?? "https://");

        if (url === null) {
            return;
        }

        if (url === "") {
            editor.chain().focus().extendMarkRange("link").unsetLink().run();

            return;
        }

        editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    };

    const button = (active: boolean, onClick: () => void, label: string) => (
        <button type="button" className={active ? "active" : ""} onClick={onClick} title={label}>
            {label}
        </button>
    );

    return (
        <div className="editor">
            <div className="editor-toolbar">
                {button(editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), "B")}
                {button(editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), "I")}
                {button(editor.isActive("underline"), () => editor.chain().focus().toggleUnderline().run(), "U")}
                {button(editor.isActive("strike"), () => editor.chain().focus().toggleStrike().run(), "S")}
                {button(
                    editor.isActive("heading", { level: 2 }),
                    () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
                    "H",
                )}
                {button(editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run(), "• List")}
                {button(
                    editor.isActive("orderedList"),
                    () => editor.chain().focus().toggleOrderedList().run(),
                    "1. List",
                )}
                {button(editor.isActive("blockquote"), () => editor.chain().focus().toggleBlockquote().run(), "Quote")}
                {button(editor.isActive("link"), setLink, "Link")}
                {button(false, () => editor.chain().focus().undo().run(), "Undo")}
                {button(false, () => editor.chain().focus().redo().run(), "Redo")}
            </div>
            <EditorContent editor={editor} className="editor-content" />
        </div>
    );
};
