#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DataProcPipelineAppStack } from '../lib/data-proc-pipeline-app-stack';

const app = new cdk.App();
new DataProcPipelineAppStack(app, 'DataProcPipelineAppStack', {
});