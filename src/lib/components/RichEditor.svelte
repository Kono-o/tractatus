<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import Highlight from '@tiptap/extension-highlight';
  import Subscript from '@tiptap/extension-subscript';
  import Superscript from '@tiptap/extension-superscript';
  import LinkExt from '@tiptap/extension-link';
  import ImageExt from '@tiptap/extension-image';
  import TextAlign from '@tiptap/extension-text-align';
  import Placeholder from '@tiptap/extension-placeholder';
  import Underline from '@tiptap/extension-underline';
  import { marked } from 'marked';
  import TurndownService from 'turndown';
  import {
    Bold, Italic, Strikethrough, Highlighter, Code,
    Link, Image, Quote, Code2, Minus,
    AlignLeft, AlignCenter, AlignRight, Undo2, Redo2, Sigma,
    List, ListOrdered,
  } from '@lucide/svelte';

  let {
    markdown = '',
    placeholder = 'Start writing…',
    onContentChange,
    onReady,
    title = '',
    onTitleInput,
    onTitleBlur,
    titleDisabled = false,
    autoFocusTitle = false,
  }: {
    markdown?: string;
    placeholder?: string;
    onContentChange?: (md: string) => void;
    onReady?: (api: { getMarkdown: () => string; getHTML: () => string }) => void;
    title?: string;
    onTitleInput?: (e: Event) => void;
    onTitleBlur?: (e: Event) => void;
    titleDisabled?: boolean;
    autoFocusTitle?: boolean;
  } = $props();

  let editorEl: HTMLDivElement;
  let titleInputEl: HTMLInputElement | undefined;
  let editor: Editor | null = null;
  let isUpdatingFromProp = false;
  let activeStates = $state<Record<string, boolean>>({});
  let activeTextAlign = $state<string>('left');

  const turndownService = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
    linkReferenceStyle: 'full',
  });

  function preprocessForEditor(md: string): string {
    let out = md;
    out = out.replace(/(?<!=)==(.+?)==(?!=)/g, '<mark>$1</mark>');
    out = out.replace(/\^(.+?)\^/g, '<sup>$1</sup>');
    out = out.replace(/(?<!~)~(?!~)(.+?)~(?!~)/g, '<sub>$1</sub>');
    out = out.replace(/::: (center|left|right)\s*([\s\S]*?):::/g, (_m: string, align: string, inner: string) => {
      return inner.trim().split(/\n{2,}/).map((para: string) => {
        const clean = para.replace(/\n/g, '<br>').trim();
        return clean ? `<p style="text-align:${align}">${clean}</p>` : '';
      }).join('\n');
    });
    return out;
  }

  function mdToHtml(md: string): string {
    if (!md) return '';
    const pre = preprocessForEditor(md);
    return marked.parse(pre, { breaks: true, gfm: true }) as string;
  }

  function htmlToMd(html: string): string {
    if (!html || html === '<p></p>') return '';
    return turndownService.turndown(html).trim();
  }

  turndownService.addRule('strikethrough', {
    filter: ['s', 'del'],
    replacement: (content) => `~~${content}~~`,
  });

  turndownService.addRule('highlight', {
    filter: 'mark',
    replacement: (content) => `==${content}==`,
  });

  turndownService.addRule('subscript', {
    filter: 'sub',
    replacement: (content) => `~${content}~`,
  });

  turndownService.addRule('superscript', {
    filter: 'sup',
    replacement: (content) => `^${content}^`,
  });

  turndownService.addRule('underline', {
    filter: 'u',
    replacement: (content) => `<u>${content}</u>`,
  });

  turndownService.addRule('textAlign', {
    filter: (node) => {
      if (node.nodeName !== 'P' && node.nodeName !== 'H1' && node.nodeName !== 'H2' &&
          node.nodeName !== 'H3' && node.nodeName !== 'H4' && node.nodeName !== 'H5' &&
          node.nodeName !== 'H6') return false;
      const el = node as HTMLElement;
      return !!el.style?.textAlign && el.style.textAlign !== 'left';
    },
    replacement: (content, node) => {
      const align = (node as HTMLElement).style.textAlign;
      return `::: ${align}\n${content}\n:::`;
    },
  });

  function trackActiveStates() {
    if (!editor) return;
    activeStates = {
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      strike: editor.isActive('strike'),
      underline: editor.isActive('underline'),
      highlight: editor.isActive('highlight'),
      code: editor.isActive('code'),
      subscript: editor.isActive('subscript'),
      superscript: editor.isActive('superscript'),
      link: editor.isActive('link'),
      blockquote: editor.isActive('blockquote'),
      codeBlock: editor.isActive('codeBlock'),
      orderedList: editor.isActive('orderedList'),
      bulletList: editor.isActive('bulletList'),
      h1: editor.isActive('heading', { level: 1 }),
      h2: editor.isActive('heading', { level: 2 }),
      h3: editor.isActive('heading', { level: 3 }),
      h4: editor.isActive('heading', { level: 4 }),
      h5: editor.isActive('heading', { level: 5 }),
      h6: editor.isActive('heading', { level: 6 }),
    };
    const align = editor.isActive({ textAlign: 'center' }) ? 'center' :
                  editor.isActive({ textAlign: 'right' }) ? 'right' : 'left';
    activeTextAlign = align;
  }

  onMount(() => {
    if (autoFocusTitle && titleInputEl) {
      titleInputEl.focus();
      titleInputEl.select();
    }
    const initialHtml = mdToHtml(markdown);
    editor = new Editor({
      element: editorEl,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3, 4, 5, 6] },
          codeBlock: { HTMLAttributes: { class: 'editor-code-block' } },
        }),
        Highlight.configure({ multicolor: false }),
        Subscript,
        Superscript,
        Underline,
        LinkExt.configure({
          openOnClick: false,
          HTMLAttributes: { rel: 'noopener noreferrer', class: 'editor-link' },
        }),
        ImageExt.configure({ inline: false, allowBase64: false }),
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        Placeholder.configure({ placeholder }),
      ],
      content: initialHtml,
      onUpdate: () => {
        if (isUpdatingFromProp) return;
        trackActiveStates();
        const html = editor!.getHTML();
        const md = htmlToMd(html);
        onContentChange?.(md);
      },
      onSelectionUpdate: () => {
        trackActiveStates();
      },
    });

    trackActiveStates();
    onReady?.({ getMarkdown: () => htmlToMd(editor!.getHTML()), getHTML: () => editor!.getHTML() });
  });

  $effect(() => {
    if (!editor) return;
    const currentMd = htmlToMd(editor.getHTML());
    if (markdown !== currentMd) {
      isUpdatingFromProp = true;
      editor.commands.setContent(mdToHtml(markdown));
      requestAnimationFrame(() => { isUpdatingFromProp = false; });
    }
  });

  $effect(() => {
    if (!editor || !placeholder) return;
    editor.extensionManager.extensions
      .filter((e: any) => e.name === 'placeholder')
      .forEach((e: any) => {
        e.options.placeholder = placeholder;
        e.storage?.placeholder?.reset?.();
      });
  });

  onDestroy(() => {
    editor?.destroy();
    editor = null;
  });

  function isActive(name: string): boolean {
    return !!activeStates[name];
  }

  const headingLevels = [1, 2, 3, 4, 5, 6] as const;

  function toggleHeading(level: 1 | 2 | 3 | 4 | 5 | 6) {
    editor?.chain().focus().toggleHeading({ level }).run();
  }

  function setParagraph() {
    editor?.chain().focus().setParagraph().run();
  }

  let styleValue = $derived(
    isActive('h1') ? '1' :
    isActive('h2') ? '2' :
    isActive('h3') ? '3' :
    isActive('h4') ? '4' :
    isActive('h5') ? '5' :
    isActive('h6') ? '6' :
    'normal'
  );

  let positionValue = $derived(
    isActive('superscript') ? 'superscript' :
    isActive('subscript') ? 'subscript' :
    'normal'
  );

  function handleStyleChange(e: Event) {
    const val = (e.target as HTMLSelectElement).value;
    if (val === 'normal') setParagraph();
    else toggleHeading(Number(val) as 1 | 2 | 3 | 4 | 5 | 6);
  }

  function handlePositionChange(e: Event) {
    const val = (e.target as HTMLSelectElement).value;
    if (val === 'superscript') editor?.chain().focus().toggleSuperscript().run();
    else if (val === 'subscript') editor?.chain().focus().toggleSubscript().run();
    else {
      if (isActive('superscript')) editor?.chain().focus().toggleSuperscript().run();
      if (isActive('subscript')) editor?.chain().focus().toggleSubscript().run();
    }
  }

  function insertLink() {
    if (!editor) return;
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('Link URL', previousUrl || 'https://');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }

  function insertImage() {
    if (!editor) return;
    const url = window.prompt('Image URL');
    if (!url) return;
    editor.chain().focus().setImage({ src: url }).run();
  }

  function insertFootnote() {
    if (!editor) return;
    const count = (editor.getText().match(/\[\^(\d+)\]/g) || []).length + 1;
    editor.chain().focus().insertContent(`[^${count}]`).run();
  }

  function insertLatexInline() {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const selected = editor.state.doc.textBetween(from, to);
    if (selected) {
      editor.chain().focus().deleteSelection().insertContent(`$${selected}$`).run();
    } else {
      editor.chain().focus().insertContent('$\\text$').run();
    }
  }

  function insertLatexBlock() {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const selected = editor.state.doc.textBetween(from, to);
    if (selected) {
      editor.chain().focus().deleteSelection().insertContent(`$$\n${selected}\n$$`).run();
    } else {
      editor.chain().focus().insertContent('$$\n\\text\n$$').run();
    }
  }

  function setTextAlign(align: string) {
    editor?.chain().focus().setTextAlign(align).run();
  }
</script>

<div class="editor-toolbar">
  <div class="editor-toolbar-scroll">
    <div class="editor-toolbar-group editor-toolbar-group--history">
      <button type="button" class="editor-tool-btn editor-tool-btn--history" title="Undo"
        onclick={() => editor?.chain().focus().undo().run()}
      ><Undo2 class="size-3.5" /></button>
      <button type="button" class="editor-tool-btn editor-tool-btn--history" title="Redo"
        onclick={() => editor?.chain().focus().redo().run()}
      ><Redo2 class="size-3.5" /></button>
    </div>

    <div class="editor-toolbar-sep"></div>

    <div class="editor-toolbar-group">
      <button type="button" class="editor-tool-btn" title="Bold"
        class:editor-tool-btn--active={isActive('bold')}
        onclick={() => editor?.chain().focus().toggleBold().run()}
      ><Bold class="size-3.5" /></button>
      <button type="button" class="editor-tool-btn" title="Italic"
        class:editor-tool-btn--active={isActive('italic')}
        onclick={() => editor?.chain().focus().toggleItalic().run()}
      ><Italic class="size-3.5" /></button>
      <button type="button" class="editor-tool-btn" title="Strikethrough"
        class:editor-tool-btn--active={isActive('strike')}
        onclick={() => editor?.chain().focus().toggleStrike().run()}
      ><Strikethrough class="size-3.5" /></button>
      <button type="button" class="editor-tool-btn" title="Highlight"
        class:editor-tool-btn--active={isActive('highlight')}
        onclick={() => editor?.chain().focus().toggleHighlight().run()}
      ><Highlighter class="size-3.5" /></button>
      <button type="button" class="editor-tool-btn" title="Inline code"
        class:editor-tool-btn--active={isActive('code')}
        onclick={() => editor?.chain().focus().toggleCode().run()}
      ><Code class="size-3.5" /></button>
      <button type="button" class="editor-tool-btn" title="Inline LaTeX"
        onclick={insertLatexInline}
      ><Sigma class="size-3.5" /></button>
    </div>

    <div class="editor-toolbar-sep"></div>

    <div class="editor-toolbar-group">
      <select class="editor-tool-select" onchange={handleStyleChange}
        aria-label="Text style" value={styleValue}>
        <option value="normal">Normal</option>
        <option value="1">Heading 1</option>
        <option value="2">Heading 2</option>
        <option value="3">Heading 3</option>
        <option value="4">Heading 4</option>
        <option value="5">Heading 5</option>
        <option value="6">Heading 6</option>
      </select>
      <select class="editor-tool-select" onchange={handlePositionChange}
        aria-label="Text position" value={positionValue}>
        <option value="normal">Normal</option>
        <option value="superscript">Superscript</option>
        <option value="subscript">Subscript</option>
      </select>
    </div>
  </div>

  <div class="editor-toolbar-scroll">
    <div class="editor-toolbar-group">
      <button type="button" class="editor-tool-btn" title="Insert link"
        class:editor-tool-btn--active={isActive('link')}
        onclick={insertLink}
      ><Link class="size-3.5" /></button>
      <button type="button" class="editor-tool-btn" title="Insert image"
        onclick={insertImage}
      ><Image class="size-3.5" /></button>
    </div>

    <div class="editor-toolbar-sep"></div>

    <div class="editor-toolbar-group">
      <button type="button" class="editor-tool-btn" title="Blockquote"
        class:editor-tool-btn--active={isActive('blockquote')}
        onclick={() => editor?.chain().focus().toggleBlockquote().run()}
      ><Quote class="size-3.5" /></button>
      <button type="button" class="editor-tool-btn" title="Code block"
        class:editor-tool-btn--active={isActive('codeBlock')}
        onclick={() => editor?.chain().focus().toggleCodeBlock().run()}
      ><Code2 class="size-3.5" /></button>
      <button type="button" class="editor-tool-btn" title="Ordered list"
        class:editor-tool-btn--active={isActive('orderedList')}
        onclick={() => editor?.chain().focus().toggleOrderedList().run()}
      ><ListOrdered class="size-3.5" /></button>
      <button type="button" class="editor-tool-btn" title="Bullet list"
        class:editor-tool-btn--active={isActive('bulletList')}
        onclick={() => editor?.chain().focus().toggleBulletList().run()}
      ><List class="size-3.5" /></button>
      <button type="button" class="editor-tool-btn" title="Divider"
        onclick={() => editor?.chain().focus().setHorizontalRule().run()}
      ><Minus class="size-3.5" /></button>
    </div>

    <div class="editor-toolbar-sep"></div>

    <div class="editor-toolbar-group">
      <button type="button" class="editor-tool-btn" title="Align left"
        class:editor-tool-btn--active={activeTextAlign === 'left'}
        onclick={() => setTextAlign('left')}
      ><AlignLeft class="size-3.5" /></button>
      <button type="button" class="editor-tool-btn" title="Align center"
        class:editor-tool-btn--active={activeTextAlign === 'center'}
        onclick={() => setTextAlign('center')}
      ><AlignCenter class="size-3.5" /></button>
      <button type="button" class="editor-tool-btn" title="Align right"
        class:editor-tool-btn--active={activeTextAlign === 'right'}
        onclick={() => setTextAlign('right')}
      ><AlignRight class="size-3.5" /></button>
    </div>

    <div class="editor-toolbar-sep"></div>

    <div class="editor-toolbar-group">
      <button type="button" class="editor-tool-btn" title="Block LaTeX"
        onclick={insertLatexBlock}
      >$$</button>
      <button type="button" class="editor-tool-btn" title="Insert footnote"
        onclick={insertFootnote}
      >[^]</button>
    </div>
  </div>
</div>

<input
  type="text"
  bind:this={titleInputEl}
  class="editor-title-input"
  placeholder="Title"
  value={title}
  oninput={onTitleInput}
  onblur={onTitleBlur}
  disabled={titleDisabled}
/>

<div class="editor-rich-content" class:editor-rich-content--empty={!markdown}>
  <div bind:this={editorEl}></div>
</div>
