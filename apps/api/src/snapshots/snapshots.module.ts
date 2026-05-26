import { Module } from "@nestjs/common";
import { SnapshotsService } from "./snapshots.service";
import { SnapshotsController } from "./snapshots.controller";
import { PipelineRunsController } from "./pipeline-runs.controller";
import { PipelineModule } from "../pipeline/pipeline.module";

@Module({
  imports: [PipelineModule], // ProvidersService 来自 PipelineModule
  providers: [SnapshotsService],
  controllers: [SnapshotsController, PipelineRunsController],
})
export class SnapshotsModule {}
