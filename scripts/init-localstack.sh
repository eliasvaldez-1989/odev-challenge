#!/bin/bash
awslocal s3 mb s3://patient-documents
awslocal s3api put-bucket-encryption --bucket patient-documents \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
echo "LocalStack S3 initialized: patient-documents bucket created with encryption"
