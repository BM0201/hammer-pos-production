"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { Tags, Save, Check, X, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import type { Category } from "@/components/catalog-inventory/catalog-inventory-admin";

/**
 * Fase 5 (prompt-flujo-velocidad.md): extraído de catalog-inventory-admin.tsx
 * (era la pestaña "categories") para poder cargarlo con next/dynamic — solo
 * se monta cuando el usuario abre esa pestaña. Mismo comportamiento.
 */
export function CategoriesPanel({ categories, onDone }: { categories: Category[]; onDone: () => Promise<void> }) {
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState("");
  const [editName, setEditName] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  /** Generate smart code from name: first 3 uppercase consonants/letters */
  function autoCode(name: string): string {
    const clean = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z]/g, "");
    if (clean.length <= 3) return clean || "CAT";
    // Take first 3 unique-ish chars
    return clean.slice(0, 3);
  }

  async function createCategory(event: React.FormEvent) {
    event.preventDefault();
    if (!newName.trim()) { toast.error("Nombre es obligatorio."); return; }
    const code = autoCode(newName);
    setSaving(true);
    try {
      const res = await apiFetch("/api/catalog/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name: newName.trim() }),
      });
      if (!res.ok) { const body = await res.json().catch(() => null); throw new Error(body?.message ?? "No se pudo crear la categoría."); }
      setNewName("");
      toast.success("Categoría creada exitosamente.");
      await onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al crear categoría.");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(item: Category) {
    setEditingId(item.id);
    setEditCode(item.code);
    setEditName(item.name);
  }

  async function saveEdit() {
    if (!editingId || !editCode.trim() || !editName.trim()) { toast.error("Código y nombre son obligatorios."); return; }
    setSavingEdit(true);
    try {
      const res = await apiFetch(`/api/catalog/categories/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: editCode.trim(), name: editName.trim() }),
      });
      if (!res.ok) { const body = await res.json().catch(() => null); throw new Error(body?.message ?? "No se pudo actualizar."); }
      toast.success("Categoría actualizada.");
      setEditingId(null);
      await onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al actualizar.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete(item: Category) {
    const confirmed = window.confirm(`¿Eliminar la categoría "${item.name}"? Si tiene productos asociados se desactivará en lugar de eliminarse.`);
    if (!confirmed) return;
    setDeletingId(item.id);
    try {
      const res = await apiFetch(`/api/catalog/categories/${item.id}`, { method: "DELETE" });
      if (!res.ok) { const body = await res.json().catch(() => null); throw new Error(body?.message ?? "No se pudo eliminar."); }
      const result = unwrapApiData(await res.json());
      if (result.action === "DELETED") {
        toast.success("🗑️ " + result.reason);
      } else {
        toast.success("⚠️ " + result.reason);
      }
      await onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al eliminar categoría.");
    } finally {
      setDeletingId(null);
    }
  }

  async function toggleActive(item: Category) {
    try {
      await apiFetch(`/api/catalog/categories/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !item.isActive }),
      });
      toast.success(`Categoría ${item.isActive ? "archivada" : "activada"}.`);
      await onDone();
    } catch {
      toast.error("No se pudo actualizar la categoría.");
    }
  }

  return (
    <div className="space-y-4">
      <Card noPadding>
        <div className="flex items-center gap-2 px-4 py-3" style={{ background: "var(--color-surface-alt)", borderBottom: "0.5px solid var(--color-border)" }}>
          <Tags className="h-4 w-4" style={{ color: "var(--color-master-600)" }} />
          <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Crear nueva categoría</h2>
        </div>
        <div className="p-4">
          <form className="flex items-end gap-3" onSubmit={createCategory}>
            <div className="flex-1">
              <label className="block text-xs font-semibold text-gray-600 mb-1">Nombre de la categoría</label>
              <Input placeholder="Ej: Ferretería, Cemento, Pintura..." value={newName} onChange={(e) => setNewName(e.target.value)} required />
            </div>
            {newName.trim() ? (
              <div className="text-xs text-gray-500 pb-2">
                Código: <strong className="text-gray-800">{autoCode(newName)}</strong>
              </div>
            ) : null}
            <Button type="submit" variant="success" disabled={saving} icon={<Save className="h-4 w-4" />}>{saving ? "Creando…" : "Crear"}</Button>
          </form>
        </div>
      </Card>
      <Card noPadding>
        <div className="flex items-center gap-2 px-4 py-3" style={{ background: "var(--color-surface-alt)", borderBottom: "0.5px solid var(--color-border)" }}>
          <Tags className="h-4 w-4" style={{ color: "var(--color-master-600)" }} />
          <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Categorías ({categories.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="hm-table min-w-[700px] w-full">
            <thead>
              <tr>
                <th className="w-28">Código</th>
                <th>Nombre</th>
                <th className="w-24">Estado</th>
                <th className="text-right w-64">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((item) => (
                <tr key={item.id}>
                  {editingId === item.id ? (
                    <>
                      <td>
                        <Input className="text-xs h-8" value={editCode} onChange={(e) => setEditCode(e.target.value)} />
                      </td>
                      <td>
                        <Input className="text-xs h-8" value={editName} onChange={(e) => setEditName(e.target.value)} />
                      </td>
                      <td><Badge variant={item.isActive ? "success" : "warning"}>{item.isActive ? "Activo" : "Inactivo"}</Badge></td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button variant="success" size="sm" onClick={saveEdit} disabled={savingEdit} icon={<Check className="h-3.5 w-3.5" />}>
                            {savingEdit ? "..." : "Guardar"}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setEditingId(null)} icon={<X className="h-3.5 w-3.5" />}>Cancelar</Button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="font-mono text-xs font-semibold">{item.code}</td>
                      <td>{item.name}</td>
                      <td><Badge variant={item.isActive ? "success" : "warning"}>{item.isActive ? "Activo" : "Inactivo"}</Badge></td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button variant="ghost" size="sm" onClick={() => startEdit(item)} icon={<Pencil className="h-3.5 w-3.5" />}>Editar</Button>
                          <Button variant={item.isActive ? "secondary" : "success"} size="sm" onClick={() => toggleActive(item)} icon={item.isActive ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}>
                            {item.isActive ? "Archivar" : "Activar"}
                          </Button>
                          <Button variant="danger" size="sm" onClick={() => handleDelete(item)} disabled={deletingId === item.id} icon={<Trash2 className="h-3.5 w-3.5" />}>
                            {deletingId === item.id ? "..." : "Eliminar"}
                          </Button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {categories.length === 0 ? <tr><td colSpan={4} className="py-6 text-center text-[var(--color-text-muted)]">No hay categorías registradas.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
