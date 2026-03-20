import { createRoute } from '@tanstack/react-router';
import { Route as appRoute } from '../_app';
import { ObjectDetailPage } from '../../pages/ObjectDetailPage';

function ObjectDetailRoute() {
  const { bucketName, objectKey } = Route.useParams();
  return <ObjectDetailPage bucketName={bucketName} objectKey={objectKey} />;
}

export const Route = createRoute({
  path: '/buckets/$bucketName/objects/$objectKey',
  getParentRoute: () => appRoute,
  component: ObjectDetailRoute,
});
