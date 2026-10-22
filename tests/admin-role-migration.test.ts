import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/0009_admin_rpc_firebase_role.sql', 'utf8');
const orderManagementMigration = readFileSync('supabase/migrations/0016_secure_order_management.sql', 'utf8');

describe('Admin role invitation migration', () => {
  it('only resolves invitations for the verified caller email and records the stored role', () => {
    expect(migration).toMatch(/lower\(btrim\(p_email\)\) <> public\.kv_email\(\)/);
    expect(migration).toMatch(/not public\.is_allowed_issuer\(\)/);
    expect(migration).toMatch(/where lower\(email\) = public\.kv_email\(\)/);
    expect(migration).toMatch(/values \(gen_random_uuid\(\), v_rec\.email, v_rec\.role\)/);
    expect(migration).toMatch(/set role = excluded\.role/);
    expect(migration).toMatch(/perform public\.kv_resolve_admin_invitation\(public\.kv_email\(\)\)/);
  });

  it('makes agent delivery idempotent, checkbox-attested and PIN-free', () => {
    const deliverRpc = orderManagementMigration.slice(orderManagementMigration.indexOf('function public.agent_deliver'));
    expect(deliverRpc).toMatch(/function public\.agent_deliver\(p_order_id uuid\)/);
    expect(deliverRpc).not.toMatch(/p_pin/);
    expect(deliverRpc).toMatch(/v_order\.delivered_at is not null\n {5}or v_order\.cod_collected is not null/);
    expect(deliverRpc).toMatch(/assignment_status not in \('accepted', 'picked_up'\)/);
    expect(deliverRpc).toMatch(/FINAL_STATE/);
    expect(deliverRpc).toMatch(/revoke all on function public\.agent_deliver\(uuid\) from public, anon, authenticated/);
    expect(orderManagementMigration).toMatch(/drop function if exists public\.agent_deliver\(uuid, text, numeric\)/);
  });

  it('guards bulk deletion at the database and requires the exact typed confirmation', () => {
    const deletionRpc = orderManagementMigration.slice(orderManagementMigration.indexOf('function public.admin_delete_all_orders'));
    expect(deletionRpc).toMatch(/not public\.is_allowed_issuer\(\) or not public\.is_administrator\(\)/);
    expect(deletionRpc).toMatch(/p_confirmation is distinct from 'DELETE ALL ORDERS'/);
    expect(deletionRpc).toMatch(/delete from public\.order_items[\s\S]*?delete from public\.order_status_history[\s\S]*?delete from public\.orders/);
    expect(deletionRpc).toMatch(/revoke all on function public\.admin_delete_all_orders\(text\) from public, anon, authenticated/);
  });

  it('grants browser-called management RPCs to Firebase anon and denies direct resolver calls', () => {
    for (const signature of [
      'public.is_current_admin()',
      'public.is_current_super_admin()',
      'public.staff_invite_admin(text, text)',
      'public.staff_revoke_invitation(uuid)',
      'public.staff_remove_admin(text)',
    ]) {
      const functionSql = migration.slice(migration.indexOf(`function ${signature}`));
      expect(functionSql, `${signature} grant`).toMatch(/grant execute[\s\S]*?to anon, authenticated/);
      expect(functionSql, `${signature} revoke`).toMatch(/revoke execute[\s\S]*?from public, anon, authenticated/);
    }
    expect(migration).toMatch(/revoke execute on function public\.kv_resolve_admin_invitation\(text\)[\s\S]*?from public, anon, authenticated/);
    expect(migration).toMatch(/grant select on public\.admin_users, public\.admin_invitations\s+to anon, authenticated/);
  });
});
