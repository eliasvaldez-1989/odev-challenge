import { Router } from 'express';
import { DocumentsController } from '../controllers/documents.controller';
import { auth } from '../middleware/auth';
import { authorize } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { getDocumentParamsSchema, listDocumentsQuerySchema } from '../schemas/document.schema';

export function documentRoutes(controller: DocumentsController): Router {
  const router = Router();

  router.use(auth());

  router.post(
    '/',
    authorize('admin', 'doctor'),
    controller.upload
  );

  router.get(
    '/',
    authorize('admin', 'doctor', 'patient'),
    validate({ query: listDocumentsQuerySchema }),
    controller.list
  );

  router.get(
    '/:id',
    authorize('admin', 'doctor', 'patient'),
    validate({ params: getDocumentParamsSchema }),
    controller.getById
  );

  return router;
}
