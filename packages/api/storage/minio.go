package storage

import (
	"context"
	"fmt"
	"io"
	"log"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

var Client *minio.Client

// InitStorage initializes the MinIO client and ensures the bucket exists.
func InitStorage(endpoint, accessKey, secretKey string, useSSL bool, bucket string) error {
	var err error
	Client, err = minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
	})
	if err != nil {
		return fmt.Errorf("failed to create minio client: %w", err)
	}

	ctx := context.Background()
	exists, err := Client.BucketExists(ctx, bucket)
	if err != nil {
		return fmt.Errorf("failed to check bucket existence: %w", err)
	}

	if !exists {
		if err := Client.MakeBucket(ctx, bucket, minio.MakeBucketOptions{}); err != nil {
			return fmt.Errorf("failed to create bucket %s: %w", bucket, err)
		}
		log.Printf("Created bucket: %s", bucket)
	}

	log.Println("MinIO storage connected successfully")
	return nil
}

// UploadFile uploads a file to the specified bucket and key.
// Returns the object key on success.
func UploadFile(bucket, key string, reader io.Reader, size int64, contentType string) (string, error) {
	ctx := context.Background()
	opts := minio.PutObjectOptions{
		ContentType: contentType,
	}

	info, err := Client.PutObject(ctx, bucket, key, reader, size, opts)
	if err != nil {
		return "", fmt.Errorf("failed to upload file: %w", err)
	}

	log.Printf("Uploaded %s (%d bytes) to %s/%s", key, info.Size, bucket, key)
	return key, nil
}

// DownloadFile retrieves a file from the specified bucket and key.
func DownloadFile(bucket, key string) (io.ReadCloser, error) {
	ctx := context.Background()
	obj, err := Client.GetObject(ctx, bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to download file: %w", err)
	}
	return obj, nil
}

// DeleteFile removes a file from the specified bucket and key.
func DeleteFile(bucket, key string) error {
	ctx := context.Background()
	err := Client.RemoveObject(ctx, bucket, key, minio.RemoveObjectOptions{})
	if err != nil {
		return fmt.Errorf("failed to delete file: %w", err)
	}
	log.Printf("Deleted %s/%s", bucket, key)
	return nil
}

// FileExists checks if a file exists in the specified bucket.
func FileExists(bucket, key string) (bool, error) {
	ctx := context.Background()
	_, err := Client.StatObject(ctx, bucket, key, minio.StatObjectOptions{})
	if err != nil {
		errResp := minio.ToErrorResponse(err)
		if errResp.Code == "NoSuchKey" {
			return false, nil
		}
		return false, err
	}
	return true, nil
}
