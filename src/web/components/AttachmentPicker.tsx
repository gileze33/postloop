import type { ChangeEvent } from "react";

interface AttachmentPickerProps {
    files: File[];
    onChange: (files: File[]) => void;
}

export const AttachmentPicker = ({ files, onChange }: AttachmentPickerProps) => {
    const onPick = (event: ChangeEvent<HTMLInputElement>) => {
        const picked = event.target.files ? Array.from(event.target.files) : [];
        onChange([...files, ...picked]);
        event.target.value = ""; // let the same file be re-picked after removal
    };

    const remove = (index: number) => onChange(files.filter((_, current) => current !== index));

    return (
        <div className="attachments">
            <label className="attach-btn">
                Attach files
                <input type="file" multiple onChange={onPick} hidden />
            </label>
            {files.length > 0 && (
                <ul className="attach-list">
                    {files.map((file, index) => (
                        <li key={`${file.name}-${index}`}>
                            <span>{file.name}</span>
                            <button type="button" onClick={() => remove(index)}>
                                Remove
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};
