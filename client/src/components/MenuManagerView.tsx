import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import * as Collapsible from "@radix-ui/react-collapsible";
import { RefreshCw, Loader2, Trash2, Pencil, Plus, ImageIcon, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LiveMenuData, LiveMenuItem, LiveCollection } from "@/lib/menu/menuFetch";

export interface MenuItemPatch {
  title?: string;
  price?: string;
  currency?: string;
  description?: string;
  imageUrl?: string;
}

interface MenuManagerViewProps {
  pubkey: string;
  relays: string[];
  loading: boolean;
  error: string | null;
  menuData: LiveMenuData | null;
  onRefresh: () => void;
  onImport: () => void;
  onDeleteItems: (addresses: string[]) => Promise<void>;
  onEditItem: (item: LiveMenuItem, patch: MenuItemPatch) => Promise<void>;
  onUnpublishAll: () => Promise<void>;
}

interface MenuSection {
  collection: LiveCollection;
  label: string;
  items: LiveMenuItem[];
}

interface MenuGroup {
  menu: LiveCollection | null;
  label: string;
  sections: MenuSection[];
  /** Items in the menu but not in any of its sections */
  directItems: LiveMenuItem[];
}

function isMenuTitle(title: string): boolean {
  return title.endsWith(" Menu") || title === "Menu";
}

function isSectionTitle(title: string): boolean {
  return title.endsWith(" Menu Section");
}

function buildMenuHierarchy(data: LiveMenuData): MenuGroup[] {
  const collectionByDTag = new Map<string, LiveCollection>();
  const collectionItemSet = new Map<string, Set<string>>();
  for (const c of data.collections) {
    collectionByDTag.set(c.dTag, c);
    collectionItemSet.set(c.dTag, new Set(c.itemDTags));
  }

  const itemByDTag = new Map<string, LiveMenuItem>();
  for (const item of data.items) itemByDTag.set(item.dTag, item);

  // Classify collections into menus and sections by title convention
  const menus: LiveCollection[] = [];
  const sections: LiveCollection[] = [];
  const other: LiveCollection[] = [];
  for (const c of data.collections) {
    if (c.itemDTags.length === 0) continue; // skip empty collections
    if (isSectionTitle(c.title)) sections.push(c);
    else if (isMenuTitle(c.title)) menus.push(c);
    else other.push(c);
  }

  // Match sections to their parent menu: a section belongs to a menu if
  // every item in the section also appears in the menu.
  const sectionToMenu = new Map<string, string>(); // section dTag -> menu dTag
  for (const section of sections) {
    const sectionItems = collectionItemSet.get(section.dTag)!;
    for (const menu of menus) {
      const menuItems = collectionItemSet.get(menu.dTag)!;
      if ([...sectionItems].every((d) => menuItems.has(d))) {
        sectionToMenu.set(section.dTag, menu.dTag);
        break;
      }
    }
  }

  const groups: MenuGroup[] = [];
  const assignedItems = new Set<string>();

  // Build groups for each menu
  for (const menu of menus) {
    const menuItems = collectionItemSet.get(menu.dTag)!;
    const childSections: MenuSection[] = [];
    const coveredBySection = new Set<string>();

    for (const section of sections) {
      if (sectionToMenu.get(section.dTag) !== menu.dTag) continue;
      const sectionItems = section.itemDTags
        .map((d) => itemByDTag.get(d))
        .filter((i): i is LiveMenuItem => i !== undefined);
      if (sectionItems.length === 0) continue;
      childSections.push({
        collection: section,
        label: section.title || section.dTag,
        items: sectionItems,
      });
      for (const item of sectionItems) {
        coveredBySection.add(item.dTag);
        assignedItems.add(item.dTag);
      }
    }

    // Items in menu but not covered by any section
    const directItems = [...menuItems]
      .filter((d) => !coveredBySection.has(d))
      .map((d) => itemByDTag.get(d))
      .filter((i): i is LiveMenuItem => i !== undefined);
    for (const item of directItems) assignedItems.add(item.dTag);

    if (childSections.length > 0 || directItems.length > 0) {
      groups.push({
        menu,
        label: menu.title || menu.dTag,
        sections: childSections,
        directItems,
      });
    }
  }

  // Orphan sections (not matched to any menu)
  for (const section of sections) {
    if (sectionToMenu.has(section.dTag)) continue;
    const sectionItems = section.itemDTags
      .map((d) => itemByDTag.get(d))
      .filter((i): i is LiveMenuItem => i !== undefined && !assignedItems.has(i.dTag));
    if (sectionItems.length === 0) continue;
    for (const item of sectionItems) assignedItems.add(item.dTag);
    groups.push({
      menu: null,
      label: section.title || section.dTag,
      sections: [],
      directItems: sectionItems,
    });
  }

  // "Other" collections (neither menu nor section title)
  for (const c of other) {
    const items = c.itemDTags
      .map((d) => itemByDTag.get(d))
      .filter((i): i is LiveMenuItem => i !== undefined && !assignedItems.has(i.dTag));
    if (items.length === 0) continue;
    for (const item of items) assignedItems.add(item.dTag);
    groups.push({
      menu: null,
      label: c.title || c.dTag,
      sections: [],
      directItems: items,
    });
  }

  // Uncategorized items
  const uncategorized = data.items.filter((item) => !assignedItems.has(item.dTag));
  if (uncategorized.length > 0) {
    groups.push({
      menu: null,
      label: "Uncategorized",
      sections: [],
      directItems: uncategorized,
    });
  }

  return groups;
}

export function MenuManagerView({
  pubkey,
  loading,
  error,
  menuData,
  onRefresh,
  onImport,
  onDeleteItems,
  onEditItem,
  onUnpublishAll,
}: MenuManagerViewProps): JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [unpublishConfirmOpen, setUnpublishConfirmOpen] = useState(false);
  const [unpublishBusy, setUnpublishBusy] = useState(false);

  // Edit dialog state
  const [editItem, setEditItem] = useState<LiveMenuItem | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editCurrency, setEditCurrency] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editImageUrl, setEditImageUrl] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  const totalItems = menuData?.items.length ?? 0;

  const toggleItem = (dTag: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(dTag)) next.delete(dTag);
      else next.add(dTag);
      return next;
    });
  };

  const toggleAll = () => {
    if (!menuData) return;
    if (selected.size === totalItems) {
      setSelected(new Set());
    } else {
      setSelected(new Set(menuData.items.map((i) => i.dTag)));
    }
  };

  const handleBulkDelete = async () => {
    if (!menuData) return;
    const addresses = menuData.items
      .filter((item) => selected.has(item.dTag))
      .map((item) => `30402:${pubkey}:${item.dTag}`);
    if (!addresses.length) return;
    setDeleteBusy(true);
    try {
      await onDeleteItems(addresses);
      setSelected(new Set());
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleSingleDelete = async (item: LiveMenuItem) => {
    const address = `30402:${pubkey}:${item.dTag}`;
    setDeleteBusy(true);
    try {
      await onDeleteItems([address]);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(item.dTag);
        return next;
      });
    } finally {
      setDeleteBusy(false);
    }
  };

  const openEdit = (item: LiveMenuItem) => {
    setEditItem(item);
    setEditTitle(item.title);
    setEditPrice(item.price);
    setEditCurrency(item.currency);
    setEditDescription(item.description);
    setEditImageUrl(item.imageUrl);
  };

  const handleEditSave = async () => {
    if (!editItem) return;
    setEditBusy(true);
    try {
      await onEditItem(editItem, {
        title: editTitle,
        price: editPrice,
        currency: editCurrency,
        description: editDescription,
        imageUrl: editImageUrl,
      });
      setEditItem(null);
    } finally {
      setEditBusy(false);
    }
  };

  const handleUnpublish = async () => {
    setUnpublishBusy(true);
    try {
      await onUnpublishAll();
    } finally {
      setUnpublishBusy(false);
      setUnpublishConfirmOpen(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Loading menu from relays...</span>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
        <Button onClick={onRefresh} variant="outline" size="sm">
          <RefreshCw className="mr-2 h-4 w-4" />
          Retry
        </Button>
      </div>
    );
  }

  // Empty state
  if (!menuData || totalItems === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <div className="rounded-full bg-muted p-4">
          <Plus className="h-8 w-8 text-muted-foreground" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">No menu published yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Import your menu from Square, PDF, or spreadsheet to get started.
          </p>
        </div>
        <Button onClick={onImport}>
          <Plus className="mr-2 h-4 w-4" />
          Import Menu
        </Button>
      </div>
    );
  }

  const groups = buildMenuHierarchy(menuData);

  const renderItemRow = (item: LiveMenuItem) => (
    <div
      key={item.dTag}
      className="flex items-start gap-3 px-4 py-3"
    >
      <input
        type="checkbox"
        checked={selected.has(item.dTag)}
        onChange={() => toggleItem(item.dTag)}
        className="mt-1 h-4 w-4 rounded border-gray-300 accent-primary"
      />
      {item.imageUrl ? (
        <img
          src={item.imageUrl}
          alt={item.title}
          className="h-12 w-12 shrink-0 rounded object-cover"
        />
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-muted">
          <ImageIcon className="h-5 w-5 text-muted-foreground" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{item.title}</span>
          {item.price && (
            <span className="text-sm text-muted-foreground">
              ${item.price} {item.currency !== "USD" ? item.currency : ""}
            </span>
          )}
        </div>
        {item.description && (
          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
            {item.description}
          </p>
        )}
        {item.tTags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {item.tTags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          onClick={() => openEdit(item)}
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          onClick={() => void handleSingleDelete(item)}
          disabled={deleteBusy}
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {totalItems} item{totalItems === 1 ? "" : "s"} published
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={onRefresh} variant="outline" size="sm">
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
            Refresh
          </Button>
          <Button onClick={onImport} size="sm">
            <Plus className="mr-2 h-3.5 w-3.5" />
            Import Menu
          </Button>
        </div>
      </div>

      {/* Bulk select bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-md border bg-muted/50 p-3">
          <button
            type="button"
            onClick={toggleAll}
            className="text-sm font-medium text-primary hover:underline"
          >
            {selected.size === totalItems ? "Deselect all" : "Select all"}
          </button>
          <span className="text-sm text-muted-foreground">
            {selected.size} selected
          </span>
          <Button
            onClick={handleBulkDelete}
            disabled={deleteBusy}
            variant="destructive"
            size="sm"
            className="ml-auto"
          >
            {deleteBusy ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="mr-2 h-3.5 w-3.5" />
            )}
            Delete {selected.size} item{selected.size === 1 ? "" : "s"}
          </Button>
        </div>
      )}

      {/* Menu hierarchy */}
      {groups.map((group) => {
        const itemCount = group.directItems.length +
          group.sections.reduce((sum, s) => sum + s.items.length, 0);
        return (
          <Collapsible.Root key={group.label} defaultOpen className="rounded-lg border bg-card">
            <Collapsible.Trigger className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-muted/50 group">
              <div>
                <h3 className="text-sm font-semibold">{group.label}</h3>
                {group.menu?.summary && group.menu.summary !== group.label && (
                  <p className="text-xs text-muted-foreground">{group.menu.summary}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{itemCount} item{itemCount === 1 ? "" : "s"}</span>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
              </div>
            </Collapsible.Trigger>
            <Collapsible.Content className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
              {/* Direct items (in menu but not in any section) */}
              {group.directItems.length > 0 && (
                <div className="divide-y border-t">
                  {group.directItems.map(renderItemRow)}
                </div>
              )}

              {/* Sections within this menu */}
              {group.sections.map((section) => (
                <div key={section.collection.dTag}>
                  <div className="border-t bg-muted/30 px-4 py-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {section.label}
                    </h4>
                  </div>
                  <div className="divide-y">
                    {section.items.map(renderItemRow)}
                  </div>
                </div>
              ))}
            </Collapsible.Content>
          </Collapsible.Root>
        );
      })}

      {/* Footer: Unpublish All */}
      <div className="flex justify-end border-t pt-4">
        <Button
          onClick={() => setUnpublishConfirmOpen(true)}
          variant="destructive"
          size="sm"
        >
          Unpublish All
        </Button>
      </div>

      {/* Edit Dialog */}
      <Dialog open={editItem !== null} onOpenChange={(open) => { if (!open) setEditItem(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Menu Item</DialogTitle>
            <DialogDescription>
              Update the item details. Changes will be published to your relays.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-title">Title</Label>
              <Input
                id="edit-title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-price">Price</Label>
                <Input
                  id="edit-price"
                  value={editPrice}
                  onChange={(e) => setEditPrice(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-currency">Currency</Label>
                <Input
                  id="edit-currency"
                  value={editCurrency}
                  onChange={(e) => setEditCurrency(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-image">Image URL</Label>
              <Input
                id="edit-image"
                value={editImageUrl}
                onChange={(e) => setEditImageUrl(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditItem(null)} disabled={editBusy}>
              Cancel
            </Button>
            <Button onClick={handleEditSave} disabled={editBusy}>
              {editBusy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unpublish All Confirmation */}
      <AlertDialog open={unpublishConfirmOpen} onOpenChange={setUnpublishConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unpublish entire menu?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove all {totalItems} menu item{totalItems === 1 ? "" : "s"} and{" "}
              {menuData.collections.length} collection{menuData.collections.length === 1 ? "" : "s"}{" "}
              from your relays. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unpublishBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUnpublish}
              disabled={unpublishBusy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {unpublishBusy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Unpublishing...
                </>
              ) : (
                "Unpublish All"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
