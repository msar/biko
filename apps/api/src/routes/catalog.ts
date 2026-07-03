import { FastifyInstance } from 'fastify';

// Catálogo global (solo lectura para los hogares): entidades y definiciones
// estándar de medios de pago. Se administra por seed, no por UI de hogar.
export default async function catalogRoutes(app: FastifyInstance) {
  app.get('/catalog/entities', { preHandler: [app.authenticate] }, async () => {
    return app.prisma.entity.findMany({ orderBy: { name: 'asc' } });
  });

  app.get('/catalog/payment-method-definitions', { preHandler: [app.authenticate] }, async () => {
    return app.prisma.paymentMethodDefinition.findMany({
      where: { active: true },
      include: { entity: true },
      orderBy: { name: 'asc' },
    });
  });
}
