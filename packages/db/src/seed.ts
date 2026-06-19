import { sql } from 'drizzle-orm';
import type { Database } from './client.js';

export const DEMO_IDS = {
  organizationA: '11111111-1111-4111-8111-111111111111',
  organizationB: '22222222-2222-4222-8222-222222222222',
  organizationC: '33333333-3333-4333-8333-333333333333',
  organizationD: '44444444-4444-4444-8444-444444444444',
  organizationE: '55555555-5555-4555-8555-555555555555',
  userA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  userB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  userC: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  userD: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  userE: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
} as const;

export async function seedDemoData(db: Database): Promise<void> {
  await db.execute(sql`
    INSERT INTO organizations (id, name, credits)
    VALUES
      (${DEMO_IDS.organizationA}::uuid, 'Northstar Hotels', 10),
      (${DEMO_IDS.organizationB}::uuid, 'Harborview Group', 2),
      (${DEMO_IDS.organizationC}::uuid, 'Meridian Consulting', 50),
      (${DEMO_IDS.organizationD}::uuid, 'Atlas Group', 100),
      (${DEMO_IDS.organizationE}::uuid, 'Solaris Ventures', 75)
    ON CONFLICT (id) DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO users (id, email, name)
    VALUES
      (${DEMO_IDS.userA}::uuid, 'alex@northstar.demo', 'Alex Morgan'),
      (${DEMO_IDS.userB}::uuid, 'bailey@harborview.demo', 'Bailey Chen'),
      (${DEMO_IDS.userC}::uuid, 'casey@meridian.demo', 'Casey Reyes'),
      (${DEMO_IDS.userD}::uuid, 'dana@atlas.demo', 'Dana Park'),
      (${DEMO_IDS.userE}::uuid, 'jordan@solaris.demo', 'Jordan Silva')
    ON CONFLICT (id) DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO organization_memberships (user_id, organization_id, role)
    VALUES
      (${DEMO_IDS.userA}::uuid, ${DEMO_IDS.organizationA}::uuid, 'owner'),
      (${DEMO_IDS.userB}::uuid, ${DEMO_IDS.organizationB}::uuid, 'owner'),
      (${DEMO_IDS.userC}::uuid, ${DEMO_IDS.organizationC}::uuid, 'owner'),
      (${DEMO_IDS.userD}::uuid, ${DEMO_IDS.organizationD}::uuid, 'owner'),
      (${DEMO_IDS.userE}::uuid, ${DEMO_IDS.organizationE}::uuid, 'owner')
    ON CONFLICT (user_id, organization_id) DO NOTHING
  `);
}
