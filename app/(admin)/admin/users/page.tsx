'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Search, Filter, Plus, Pencil, Power, Trash2, Users, UserCog, ShieldCheck,
  PackageCheck, UserCircle,
} from 'lucide-react';
import { getUsers, toggleUserActive, deleteUser as deleteUserApi } from '@/lib/admin/api';
import { useUserRole } from '@/app/(admin)/admin/layout';
import { canCreate, canEdit, canDelete, getRoleBadgeClasses, getRoleName } from '@/lib/permissions';
import type { Customer } from '@/lib/supabase';
import type { UserRole } from '@/lib/permissions';
import { rankBySearch, byNewest } from '@/lib/search';
import StatTile from '@/components/admin/StatTile';
import TableSkeleton from '@/components/admin/TableSkeleton';
import Pagination from '@/components/admin/Pagination';
import CreateUserModal from './_components/CreateUserModal';
import EditUserModal from './_components/EditUserModal';
import DeletionReviewModal from '../_components/DeletionReviewModal';

const PAGE_SIZE = 20;

const roleOf = (u: Customer): UserRole => (u.role || (u.is_admin ? 'admin' : 'customer')) as UserRole;

const initials = (f?: string | null, l?: string | null, fallback?: string | null) => {
  const a = (f ?? '').trim();
  const b = (l ?? '').trim();
  if (a || b) return `${a[0] ?? ''}${b[0] ?? ''}`.toUpperCase();
  const fb = (fallback ?? '').trim();
  return fb ? fb[0].toUpperCase() : '?';
};

export default function AdminUsersPage() {
  const userRole = useUserRole();
  const [users, setUsers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [toggling, setToggling] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);

  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState<Customer | null>(null);
  const [deleteUser, setDeleteUser] = useState<Customer | null>(null);

  const loadUsers = useCallback(() => {
    setLoading(true);
    getUsers()
      .then(setUsers)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const filtered = useMemo(() => {
    let result = users;
    if (search) {
      result = rankBySearch(
        result,
        search,
        [
          { value: (u) => u.first_name, weight: 3 },
          { value: (u) => u.last_name, weight: 3 },
          { value: (u) => `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim(), weight: 2 },
          { value: (u) => u.email, weight: 1 },
        ],
        byNewest,
      );
    }
    if (roleFilter !== 'all') result = result.filter((u) => roleOf(u) === roleFilter);
    if (statusFilter === 'active') result = result.filter((u) => u.active !== false);
    else if (statusFilter === 'inactive') result = result.filter((u) => u.active === false);
    return result;
  }, [search, roleFilter, statusFilter, users]);

  // Reset to the first page whenever the filtered set changes.
  useEffect(() => { setPage(0); }, [search, roleFilter, statusFilter]);

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const paged = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  // Role breakdown for the stat tiles.
  const stats = useMemo(() => {
    let active = 0, admins = 0, assistants = 0, warehouse = 0, customers = 0;
    for (const u of users) {
      if (u.active !== false) active += 1;
      const r = roleOf(u);
      if (r === 'admin') admins += 1;
      else if (r === 'assistant') assistants += 1;
      else if (r === 'warehouse') warehouse += 1;
      else if (r === 'customer') customers += 1;
    }
    return { total: users.length, active, admins, assistants, warehouse, customers };
  }, [users]);

  const handleToggleActive = async (user: Customer) => {
    setToggling(user.id);
    await toggleUserActive(user.id, !user.active);
    loadUsers();
    setToggling(null);
  };

  const showActions = canEdit(userRole) || canDelete(userRole);
  const colCount = 5 + (showActions ? 1 : 0);
  const filtersActive = !!search || roleFilter !== 'all' || statusFilter !== 'all';

  return (
    <>
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-xl sm:text-2xl font-bold text-ink flex items-center gap-2">
          <UserCog className="w-6 h-6 text-bronze" /> Users
        </h1>
        <p className="text-sm text-ink-muted mt-1 max-w-2xl">
          Everyone with an account — staff and customers. Manage roles, access and activation.
        </p>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 md:gap-4 mb-6">
        <StatTile icon={Users} tint="ink" label="Total" value={stats.total}
          sub={`${stats.active} active`} loading={loading} />
        <StatTile icon={ShieldCheck} tint="bronze" label="Admins" value={stats.admins}
          sub="full access" loading={loading} />
        <StatTile icon={UserCog} tint="blue" label="Assistants" value={stats.assistants}
          sub="read-only" loading={loading} />
        <StatTile icon={PackageCheck} tint="indigo" label="Warehouse" value={stats.warehouse}
          sub="fulfillment" loading={loading} />
        <StatTile icon={UserCircle} tint="emerald" label="Customers" value={stats.customers}
          sub="accounts" loading={loading} />
      </div>

      {/* Filters + Add button */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
          <input
            type="text"
            placeholder="Search users by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-line rounded-lg text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-bronze/40"
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="pl-10 pr-8 py-2.5 bg-white border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40 appearance-none"
          >
            <option value="all">All Roles</option>
            <option value="customer">Customer</option>
            <option value="affiliate">Affiliate</option>
            <option value="warehouse">Warehouse</option>
            <option value="analytics">Analytics</option>
            <option value="assistant">Assistant</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div className="relative">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 pr-8 py-2.5 bg-white border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40 appearance-none"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        {canCreate(userRole) && (
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-ink text-white rounded-lg text-sm font-semibold hover:bg-ink/90 transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Add User
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-line overflow-hidden">
        <div className="p-5 md:p-6 border-b border-line flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">Users</h2>
          <span className="text-sm text-ink-muted">{total} total</span>
        </div>
        {/* Desktop table (≥lg) / mobile cards — per ADR 0007. */}
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr className="border-b border-line">
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">User</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Phone</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Role</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Status</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Joined</th>
                {showActions && (
                  <th className="px-5 py-3 text-right text-xs font-semibold text-ink-muted uppercase tracking-wider">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50">
              {loading ? (
                <TableSkeleton rows={8} cols={colCount} />
              ) : (
                paged.map((user) => {
                  const role = roleOf(user);
                  const isActive = user.active !== false;
                  return (
                    <tr key={user.id} className="hover:bg-surface transition-colors">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <span className={`shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg text-xs font-semibold ${getRoleBadgeClasses(role)}`}>
                            {initials(user.first_name, user.last_name, user.email)}
                          </span>
                          <div className="min-w-0">
                            <div className="font-medium text-ink text-sm truncate">{`${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || '—'}</div>
                            <div className="text-xs text-ink-muted break-all">{user.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm text-ink-muted whitespace-nowrap">{user.phone || '—'}</td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${getRoleBadgeClasses(role)}`}>
                          {getRoleName(role)}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${
                          isActive ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-500'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-red-400'}`} />
                          {isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-sm text-ink-muted whitespace-nowrap">
                        {new Date(user.created_at).toLocaleDateString()}
                      </td>
                      {showActions && (
                        <td className="px-5 py-4">
                          <div className="flex items-center justify-end gap-1.5">
                            {canEdit(userRole) && (
                              <>
                                <button
                                  onClick={() => setEditUser(user)}
                                  title="Edit user"
                                  className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-line bg-surface text-ink-muted hover:text-ink hover:bg-line/20 transition-colors"
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleToggleActive(user)}
                                  disabled={toggling === user.id}
                                  title={isActive ? 'Deactivate user' : 'Activate user'}
                                  className={`inline-flex items-center justify-center w-9 h-9 rounded-lg border transition-colors disabled:opacity-50 ${
                                    isActive
                                      ? 'border-amber-500/20 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20'
                                      : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20'
                                  }`}
                                >
                                  <Power className="w-4 h-4" />
                                </button>
                              </>
                            )}
                            {canDelete(userRole) && (
                              <button
                                onClick={() => setDeleteUser(user)}
                                title="Delete user"
                                className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-red-500/20 bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
              {!loading && total === 0 && (
                <tr>
                  <td colSpan={colCount} className="px-5 py-12 text-center text-ink-muted text-sm">
                    {filtersActive ? 'No users match your filters' : 'No users yet'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards (below lg) — same rows and actions. ADR 0007. */}
        <div className="lg:hidden">
          {loading ? (
            <div className="divide-y divide-line/50">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="px-4 py-3.5 animate-pulse flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-surface shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-32 bg-surface rounded" />
                    <div className="h-3 w-44 bg-surface rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : total === 0 ? (
            <div className="px-5 py-12 text-center text-ink-muted text-sm">
              {filtersActive ? 'No users match your filters' : 'No users yet'}
            </div>
          ) : (
            <ul className="divide-y divide-line/50">
              {paged.map((user) => {
                const role = roleOf(user);
                const isActive = user.active !== false;
                return (
                  <li key={user.id} className="px-4 py-3.5">
                    <div className="flex items-start gap-3">
                      <span className={`shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg text-xs font-semibold ${getRoleBadgeClasses(role)}`}>
                        {initials(user.first_name, user.last_name, user.email)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-medium text-ink text-sm">{`${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || '—'}</div>
                            <div className="text-xs text-ink-muted break-all">{user.email}</div>
                          </div>
                          <span className={`inline-flex shrink-0 items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${
                            isActive ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-500'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-red-400'}`} />
                            {isActive ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
                          <span className={`inline-flex px-2 py-0.5 rounded font-medium ${getRoleBadgeClasses(role)}`}>{getRoleName(role)}</span>
                          {user.phone && <span>{user.phone}</span>}
                          <span>Joined {new Date(user.created_at).toLocaleDateString()}</span>
                        </div>
                        {showActions && (canEdit(userRole) || canDelete(userRole)) && (
                          <div className="mt-2.5 flex items-center gap-1.5">
                            {canEdit(userRole) && (
                              <>
                                <button
                                  onClick={() => setEditUser(user)}
                                  title="Edit user"
                                  className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-line bg-surface text-ink-muted hover:text-ink hover:bg-line/20 transition-colors"
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleToggleActive(user)}
                                  disabled={toggling === user.id}
                                  title={isActive ? 'Deactivate user' : 'Activate user'}
                                  className={`inline-flex items-center justify-center w-10 h-10 rounded-lg border transition-colors disabled:opacity-50 ${
                                    isActive
                                      ? 'border-amber-500/20 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20'
                                      : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20'
                                  }`}
                                >
                                  <Power className="w-4 h-4" />
                                </button>
                              </>
                            )}
                            {canDelete(userRole) && (
                              <button
                                onClick={() => setDeleteUser(user)}
                                title="Delete user"
                                className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-red-500/20 bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {!loading && total > 0 && (
          <Pagination
            page={safePage}
            pageCount={pageCount}
            onPageChange={setPage}
            total={total}
            pageSize={PAGE_SIZE}
          />
        )}
      </div>

      {/* Modals */}
      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            loadUsers();
          }}
        />
      )}
      {editUser && (
        <EditUserModal
          user={editUser}
          onClose={() => setEditUser(null)}
          onUpdated={() => {
            setEditUser(null);
            loadUsers();
          }}
        />
      )}
      {deleteUser && (
        <DeletionReviewModal
          kind="user"
          entity={deleteUser}
          onClose={() => setDeleteUser(null)}
          onDeleted={() => {
            setDeleteUser(null);
            loadUsers();
          }}
          onDeactivate={() => deleteUserApi(deleteUser.id, false)}
        />
      )}
    </>
  );
}
