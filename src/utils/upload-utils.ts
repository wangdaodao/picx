import { ToUploadImageModel, UploadedImageModel, UserConfigInfoModel } from '@/common/model'
import { store } from '@/store'
import {
  createCommit,
  createRef,
  createTree,
  uploadSingleImage,
  uploadImageBlob,
  getBranchInfo
} from '@/common/api'
import { PICX_UPLOAD_IMG_DESC } from '@/common/constant'

/**
 * 图片上传成功之后的处理
 * @param res
 * @param img
 * @param userConfigInfo
 */
const uploadedHandle = (
  res: { name: string; sha: string; path: string; size: number },
  img: ToUploadImageModel,
  userConfigInfo: UserConfigInfoModel
) => {
  let dir = userConfigInfo.selectedDir

  if (img.reUploadInfo.isReUpload) {
    dir = img.reUploadInfo.dir
  }

  // 上传状态处理
  img.uploadStatus.progress = 100
  img.uploadStatus.uploading = false

  const uploadedImg: UploadedImageModel = {
    checked: false,
    type: 'image',
    uuid: img.uuid,
    dir,
    name: res.name,
    sha: res.sha,
    path: res.path,
    deleting: false,
    size: res.size
  }

  img.uploadedImg = uploadedImg

  // uploadedList 增加图片
  store.dispatch('UPLOADED_LIST_ADD', uploadedImg)

  // dirImageList 增加目录
  store.dispatch('DIR_IMAGE_LIST_ADD_DIR', dir)

  // dirImageList 增加图片
  store.dispatch('DIR_IMAGE_LIST_ADD_IMAGE', uploadedImg)
}

export const uploadUrlHandle = (
  config: UserConfigInfoModel,
  imgObj: ToUploadImageModel
): string => {
  const { owner, selectedRepo: repo, selectedDir: dir } = config
  const filename: string = imgObj.filename.final

  let path = filename

  if (dir !== '/') {
    path = `${dir}/${filename}`
  }

  if (imgObj.reUploadInfo.isReUpload) {
    path = imgObj.reUploadInfo.path
  }

  return `/repos/${owner}/${repo}/contents/${path}`
}

export async function uploadImagesToGitHub(
  userConfigInfo: UserConfigInfoModel,
  imgs: ToUploadImageModel[]
): Promise<void> {
  const { selectedBranch: branch, selectedRepo: repo, selectedDir, owner } = userConfigInfo

  const blobs = []
  // eslint-disable-next-line no-restricted-syntax
  for (const img of imgs) {
    img.uploadStatus.uploading = true
    // 上传图片文件，为仓库创建 blobs
    const blobRes = await uploadImageBlob(img, owner, repo)
    img.uploadStatus.uploading = false
    if (blobRes) {
      blobs.push({ img, ...blobRes })
      // 已上传数量 +1
      store.dispatch('TO_UPLOAD_IMAGE_UPLOADED', img.uuid)
    } else {
      ElMessage.error(`${img.filename.final} 上传失败`)
    }
  }

  // 获取 head，用于获取当前分支信息（根目录的 tree sha 以及 head commit sha）
  const branchRes: any = await getBranchInfo(owner, repo, branch)
  if (!branchRes) {
    throw new Error('获取分支信息失败')
  }

  const finalPath = selectedDir === '/' ? '' : `${selectedDir}/`

  // 创建 tree
  const treeRes = await createTree(
    owner,
    repo,
    blobs.map((x: any) => ({
      sha: x.sha,
      path: `${finalPath}${x.img.filename.final}`
    })),
    branchRes
  )
  if (!treeRes) {
    throw new Error('创建 tree 失败')
  }

  // 创建 commit 节点
  const commitRes: any = await createCommit(owner, repo, treeRes, branchRes)
  if (!commitRes) {
    throw new Error('创建 commit 失败')
  }

  // 将当前分支 ref 指向新创建的 commit
  const refRes = await createRef(owner, repo, branch, commitRes.sha)
  if (!refRes) {
    throw new Error('更新 ref 失败')
  }

  blobs.forEach((blob: any) => {
    const name = blob.img.filename.final
    uploadedHandle(
      { name, sha: blob.sha, path: `${finalPath}${name}`, size: 0 },
      blob.img,
      userConfigInfo
    )
  })
}

export function uploadImageToGitHub(
  userConfigInfo: UserConfigInfoModel,
  img: ToUploadImageModel
): Promise<Boolean> {
  const { selectedBranch: branch, email, owner } = userConfigInfo

  const data: any = {
    message: PICX_UPLOAD_IMG_DESC,
    branch,
    content: img.imgData.base64Content
  }

  if (email) {
    data.committer = {
      name: owner,
      email
    }
  }

  img.uploadStatus.uploading = true

  // eslint-disable-next-line no-async-promise-executor
  return new Promise(async (resolve) => {
    const uploadRes = await uploadSingleImage(uploadUrlHandle(userConfigInfo, img), data)
    console.log('uploadSingleImage >> ', uploadRes)
    img.uploadStatus.uploading = false
    if (uploadRes) {
      const { name, sha, path, size } = uploadRes.content
      uploadedHandle({ name, sha, path, size }, img, userConfigInfo)
      store.dispatch('TO_UPLOAD_IMAGE_UPLOADED', img.uuid)
      resolve(true)
    } else {
      resolve(false)
    }
  })
}
