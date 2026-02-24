/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.schema.createTable('audit_logs', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('user_id', 255).notNullable().index();
    table.string('user_role', 50).notNullable();
    table.string('action', 100).notNullable().index();
    table.string('resource_type', 100).notNullable();
    table.string('resource_id', 255).nullable();
    table.string('request_id', 255).notNullable();
    table.string('ip_address', 45).nullable();
    table.integer('status_code').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.raw(
    'CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at)'
  );
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('audit_logs');
};
