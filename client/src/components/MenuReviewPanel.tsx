import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, RefreshCw, Sparkles, ImageIcon, Pencil, Upload } from "lucide-react";
import type { MenuReviewState, MenuReviewItem } from "@/lib/menuImport/types";
import { uploadMedia } from "@/services/upload";

interface EditForm {
  name: string;
  price: string;
  currency: string;
  description: string;
  ingredients: string;
  imageUrl: string;
}

interface MenuReviewPanelProps {
  reviewState: MenuReviewState;
  enrichProgress: { current: number; total: number } | null;
  imageGenProgress: { current: number; total: number } | null;
  publishBusy: boolean;
  onEnrich: () => void;
  onGenerateImages: () => void;
  onRegenerateImage: (index: number) => void;
  onPublish: () => void;
  onUpdateItem?: (index: number, patch: Partial<MenuReviewItem>) => void;
  /** Called when the user renames a top-level menu header. */
  onRenameMenu?: (oldName: string, newName: string) => void;
  /** Called when the user renames a section sub-header. */
  onRenameSection?: (oldName: string, newName: string, parentMenuName: string) => void;
  onReUpload?: () => void;
  reUploadLabel?: string;
  reUploadAccept?: string;
}

export function MenuReviewPanel({
  reviewState,
  enrichProgress,
  imageGenProgress,
  publishBusy,
  onEnrich,
  onGenerateImages,
  onRegenerateImage,
  onPublish,
  onUpdateItem,
  onRenameMenu,
  onRenameSection,
  onReUpload,
  reUploadLabel,
  reUploadAccept,
}: MenuReviewPanelProps): JSX.Element {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [lightboxName, setLightboxName] = useState<string>("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ name: "", price: "", currency: "", description: "", ingredients: "", imageUrl: "" });
  const [imageUploading, setImageUploading] = useState(false);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Inline rename state for menu/section headers.
  // Key format: "menu::<name>" or "section::<parentMenuName>::<name>"
  const [editingHeader, setEditingHeader] = useState<string | null>(null);
  const [headerInput, setHeaderInput] = useState("");

  const startHeaderEdit = (key: string, currentName: string) => {
    setEditingHeader(key);
    setHeaderInput(currentName);
  };

  const commitHeaderEdit = (key: string) => {
    const newName = headerInput.trim();
    setEditingHeader(null);
    if (!newName || !key) return;
    if (key.startsWith("menu::")) {
      const oldName = key.slice("menu::".length);
      if (newName !== oldName) onRenameMenu?.(oldName, newName);
    } else if (key.startsWith("section::")) {
      const parts = key.split("::");
      // format: "section::<parentMenu>::<sectionName>" (parentMenu may itself contain "::")
      const sectionName = parts[parts.length - 1];
      const parentMenuName = parts.slice(1, -1).join("::");
      if (newName !== sectionName) onRenameSection?.(sectionName, newName, parentMenuName);
    }
  };

  const openEdit = (item: MenuReviewItem, idx: number) => {
    setEditingIndex(idx);
    setImageUploadError(null);
    setEditForm({
      name: item.name,
      price: item.price,
      currency: item.currency || "USD",
      description: item.enrichedDescription || item.description,
      ingredients: item.ingredients.join(", "),
      imageUrl: item.generatedImageUrl || "",
    });
  };

  const handleImageFile = async (file: File) => {
    setImageUploadError(null);
    setImageUploading(true);
    try {
      const url = await uploadMedia(file, "picture");
      setEditForm((f) => ({ ...f, imageUrl: url }));
    } catch (err) {
      setImageUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setImageUploading(false);
    }
  };

  const saveEdit = () => {
    if (editingIndex === null || !onUpdateItem) return;
    const parsed = editForm.ingredients
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const trimmedImageUrl = editForm.imageUrl.trim();
    onUpdateItem(editingIndex, {
      name: editForm.name,
      price: editForm.price,
      currency: editForm.currency,
      description: editForm.description,
      enrichedDescription: undefined,
      ingredients: parsed,
      generatedImageUrl: trimmedImageUrl || undefined,
      imageGenStatus: trimmedImageUrl ? "done" : "idle",
    });
    setEditingIndex(null);
  };

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="rounded-md border bg-muted/30 p-3 text-sm">
        <span className="font-medium">Loaded:</span> {reviewState.fileName} &mdash;{" "}
        {reviewState.items.length} item{reviewState.items.length === 1 ? "" : "s"},{" "}
        {reviewState.menus.length} menu{reviewState.menus.length === 1 ? "" : "s"}/section{reviewState.menus.length === 1 ? "" : "s"}
      </div>

      {/* Grouped item list */}
      <div className="max-h-[32rem] space-y-4 overflow-y-auto rounded-md border p-3">
        {(() => {
          const grouped = new Map<string, Map<string, { item: MenuReviewItem; idx: number }[]>>();
          reviewState.items.forEach((item, idx) => {
            const menu = item.partOfMenu || "Menu";
            const section = item.partOfMenuSection || "";
            if (!grouped.has(menu)) grouped.set(menu, new Map());
            const menuMap = grouped.get(menu)!;
            if (!menuMap.has(section)) menuMap.set(section, []);
            menuMap.get(section)!.push({ item, idx });
          });
          return Array.from(grouped.entries()).map(([menuName, sections]) => {
            const menuKey = `menu::${menuName}`;
            return (
            <div key={menuName}>
              <div className="mb-2 flex items-center gap-1.5">
                {editingHeader === menuKey ? (
                  <input
                    autoFocus
                    className="text-sm font-semibold border-b border-primary bg-transparent outline-none w-auto min-w-[4rem]"
                    value={headerInput}
                    onChange={(e) => setHeaderInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitHeaderEdit(menuKey);
                      if (e.key === "Escape") setEditingHeader(null);
                    }}
                    onBlur={() => commitHeaderEdit(menuKey)}
                    size={Math.max(headerInput.length + 1, 4)}
                  />
                ) : (
                  <>
                    <h4 className="text-sm font-semibold">{menuName}</h4>
                    {onRenameMenu && (
                      <button
                        type="button"
                        title="Rename menu"
                        onClick={() => startHeaderEdit(menuKey, menuName)}
                        className="rounded p-0.5 text-muted-foreground hover:text-primary transition-colors"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    )}
                  </>
                )}
              </div>
              {Array.from(sections.entries()).map(([sectionName, entries]) => {
                const sectionKey = `section::${menuName}::${sectionName}`;
                return (
                <div key={sectionName} className="mb-3 ml-2">
                  {sectionName && (
                    <div className="mb-1.5 flex items-center gap-1.5">
                      {editingHeader === sectionKey ? (
                        <input
                          autoFocus
                          className="text-xs font-medium text-muted-foreground uppercase tracking-wide border-b border-primary bg-transparent outline-none"
                          value={headerInput}
                          onChange={(e) => setHeaderInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitHeaderEdit(sectionKey);
                            if (e.key === "Escape") setEditingHeader(null);
                          }}
                          onBlur={() => commitHeaderEdit(sectionKey)}
                          size={Math.max(headerInput.length + 1, 4)}
                        />
                      ) : (
                        <>
                          <h5 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{sectionName}</h5>
                          {onRenameSection && (
                            <button
                              type="button"
                              title="Rename section"
                              onClick={() => startHeaderEdit(sectionKey, sectionName)}
                              className="rounded p-0.5 text-muted-foreground hover:text-primary transition-colors"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    {entries.map(({ item, idx }) => (
                      <div key={idx} className="flex items-start gap-3 rounded-md border bg-background px-3 py-2 text-sm">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{item.name}</span>
                            {item.price && (
                              <span className="text-muted-foreground">${item.price}</span>
                            )}
                          </div>
                          <p className="mt-0.5 text-muted-foreground text-xs">
                            {item.enrichedDescription || item.description || "No description"}
                          </p>
                          {item.enrichedDescription && item.description && (
                            <p className="mt-0.5 text-xs text-muted-foreground/70 line-through">
                              {item.description}
                            </p>
                          )}
                          {item.ingredients.length > 0 && (
                            <p className="mt-0.5 text-xs text-muted-foreground/60">
                              {item.ingredients.join(", ")}
                            </p>
                          )}
                          {(item.suitableForDiets.length > 0 || item.tags.length > 0) && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {item.suitableForDiets.map((diet) => (
                                <span
                                  key={diet}
                                  className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400"
                                >
                                  {diet}
                                </span>
                              ))}
                              {item.tags.map((tag) => (
                                <span
                                  key={tag}
                                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                    tag === "spicy"
                                      ? "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400"
                                      : "bg-muted text-muted-foreground"
                                  }`}
                                >
                                  {tag === "spicy" ? "🌶 spicy" : tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {item.imageGenStatus === "generating" && (
                            <Loader2 className="h-4 w-4 animate-spin text-primary" />
                          )}
                          {item.imageGenStatus === "done" && item.generatedImageUrl && (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setLightboxUrl(item.generatedImageUrl!);
                                  setLightboxName(item.name);
                                }}
                                className="rounded focus:outline-none focus:ring-2 focus:ring-primary"
                              >
                                <img
                                  src={item.generatedImageUrl}
                                  alt={item.name}
                                  className="h-10 w-10 rounded object-cover cursor-pointer hover:opacity-80 transition-opacity"
                                />
                              </button>
                              <button
                                type="button"
                                title="Regenerate image"
                                onClick={() => onRegenerateImage(idx)}
                                className="rounded p-0.5 text-muted-foreground hover:text-primary transition-colors"
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                          {item.imageGenStatus === "error" && (
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-destructive" title={item.imageGenError}>
                                Failed
                              </span>
                              <button
                                type="button"
                                title="Retry image generation"
                                onClick={() => onRegenerateImage(idx)}
                                className="rounded p-0.5 text-muted-foreground hover:text-primary transition-colors"
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                          {onUpdateItem && (
                            <button
                              type="button"
                              title="Edit item"
                              onClick={() => openEdit(item, idx)}
                              className="rounded p-0.5 text-muted-foreground hover:text-primary transition-colors"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ); })}
            </div>
          ); });
        })()}
      </div>

      {/* Enhancement actions */}
      <div className="flex flex-wrap gap-3">
        <Button
          onClick={onEnrich}
          disabled={enrichProgress !== null}
          variant="outline"
          size="sm"
        >
          {enrichProgress !== null ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Enriching descriptions ({enrichProgress.current}/{enrichProgress.total})...
            </>
          ) : (
            <>
              <Sparkles className="mr-2 h-4 w-4" />
              Enhance Descriptions
            </>
          )}
        </Button>
        <Button
          onClick={onGenerateImages}
          disabled={imageGenProgress !== null}
          variant="outline"
          size="sm"
        >
          {imageGenProgress ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Generating images ({imageGenProgress.current}/{imageGenProgress.total})...
            </>
          ) : (
            <>
              <ImageIcon className="mr-2 h-4 w-4" />
              Generate Photos
            </>
          )}
        </Button>
      </div>

      {/* Publish & re-upload */}
      <div className="flex flex-wrap gap-3">
        <Button
          onClick={onPublish}
          disabled={publishBusy}
        >
          {publishBusy ? "Publishing..." : "Publish Menu"}
        </Button>
        {onReUpload && (
          <Button type="button" variant="outline" onClick={onReUpload}>
            {reUploadLabel || "Upload Different File"}
          </Button>
        )}
      </div>

      {/* Image lightbox */}
      <Dialog open={lightboxUrl !== null} onOpenChange={(open) => { if (!open) setLightboxUrl(null); }}>
        <DialogContent className="max-w-lg p-2">
          <DialogHeader className="px-2 pt-2">
            <DialogTitle className="text-sm">{lightboxName}</DialogTitle>
          </DialogHeader>
          {lightboxUrl && (
            <img
              src={lightboxUrl}
              alt={lightboxName}
              className="w-full rounded object-contain"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Edit item dialog */}
      <Dialog open={editingIndex !== null} onOpenChange={(open) => { if (!open) setEditingIndex(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="flex gap-3">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="edit-price">Price</Label>
                <Input
                  id="edit-price"
                  value={editForm.price}
                  onChange={(e) => setEditForm((f) => ({ ...f, price: e.target.value }))}
                  placeholder="9.99"
                />
              </div>
              <div className="w-24 space-y-1.5">
                <Label htmlFor="edit-currency">Currency</Label>
                <Input
                  id="edit-currency"
                  value={editForm.currency}
                  onChange={(e) => setEditForm((f) => ({ ...f, currency: e.target.value }))}
                  placeholder="USD"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={editForm.description}
                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-ingredients">Ingredients <span className="text-muted-foreground font-normal">(comma-separated)</span></Label>
              <Textarea
                id="edit-ingredients"
                value={editForm.ingredients}
                onChange={(e) => setEditForm((f) => ({ ...f, ingredients: e.target.value }))}
                rows={2}
                placeholder="flour, eggs, butter"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Image</Label>
              {editForm.imageUrl && (
                <img
                  src={editForm.imageUrl}
                  alt="Item preview"
                  className="h-20 w-20 rounded object-cover border"
                />
              )}
              <Input
                value={editForm.imageUrl}
                onChange={(e) => setEditForm((f) => ({ ...f, imageUrl: e.target.value }))}
                placeholder="https://..."
              />
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={imageUploading}
                >
                  {imageUploading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-2 h-4 w-4" />
                  )}
                  {imageUploading ? "Uploading…" : "Upload image"}
                </Button>
                {imageUploadError && (
                  <span className="text-xs text-destructive">{imageUploadError}</span>
                )}
              </div>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleImageFile(f);
                  e.target.value = "";
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingIndex(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={!editForm.name.trim() || imageUploading}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
