import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';

import { CreateJobResponse, GetJobResponse } from './dto/create-job.dto';
import { JobsService } from './jobs.service';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async createJob(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CreateJobResponse> {
    const result: CreateJobResponse = await this.jobsService.createJob(body);
    response.location(`/jobs/${result.jobId}`);
    return result;
  }

  @Get(':id')
  async getJob(@Param('id') id: string): Promise<GetJobResponse> {
    return this.jobsService.getJob(id);
  }
}
