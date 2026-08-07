-- CreateTable
CREATE TABLE "TripForecastCache" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "destinationKey" TEXT NOT NULL,
    "rangeStart" TEXT NOT NULL,
    "rangeEnd" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripForecastCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TripForecastCache_tripId_key" ON "TripForecastCache"("tripId");

-- AddForeignKey
ALTER TABLE "TripForecastCache" ADD CONSTRAINT "TripForecastCache_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
