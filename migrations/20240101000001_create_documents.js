/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

  await knex.schema.createTable('documents', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('patient_id', 255).notNullable().index();
    table.string('doctor_id', 255).notNullable().index();
    table.string('file_key', 1024).notNullable();
    table.string('file_name', 255).notNullable();
    table.integer('file_size').notNullable();
    table.string('mime_type', 127).notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.raw(
    'CREATE INDEX idx_documents_created_at ON documents(created_at)'
  );
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('documents');
};
