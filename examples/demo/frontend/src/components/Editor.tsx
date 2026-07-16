import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect } from "react";
import type { Editor as TiptapEditor } from "@tiptap/core";

interface EditorProps {
  onEditorReady: (editor: TiptapEditor) => void;
}

export default function Editor({ onEditorReady }: EditorProps) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: `
      <h2>Welcome to tiptap-apcore Demo</h2>
      <p>This editor is controlled by APCore modules. Use the demo buttons on the right to see AI-driven editing in action.</p>
      <p>Try switching the <strong>ACL role</strong> on the left to see how permissions affect which operations are allowed.</p>
    `,
  });

  useEffect(() => {
    if (editor) {
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);

  return (
    <div className="card editor-wrapper">
      <EditorContent editor={editor} />
    </div>
  );
}
